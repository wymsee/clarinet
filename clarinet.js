;(function (clarinet) {
  // non node-js needs to set clarinet debug on root
  var env
    , fastlist
    ;

// to set debugging
if(typeof process === 'object' && process.env) env = process.env;
else env = window;

// use fastlist if fastlist is available
// fastlist is basically a crippled array that performs faster
if(typeof FastList === 'function') {
  fastlist = FastList;
} else if (typeof require === 'function') {
  try { fastlist = require('fast-list'); } catch (exc) { fastlist = Array; }
} else fastlist = Array;

  clarinet.parser            = function (opt) { return new CParser(opt); };
  clarinet.CParser           = CParser;
  clarinet.CStream           = CStream;
  clarinet.createStream      = createStream;
  clarinet.MAX_BUFFER_LENGTH = 64 * 1024;
  clarinet.DEBUG             = (env.CDEBUG==='debug');
  clarinet.INFO              = (env.CDEBUG==='debug' || env.CDEBUG==='info');
  clarinet.EVENTS            =
    [ "value"
    , "string"
    , "key"
    , "openobject"
    , "closeobject"
    , "openarray"
    , "closearray"
    , "error"
    , "end"
    , "ready"
    ];

  // buffer names, not the actual buffers. actual buffers are sorted in the
  // parser
  var buffers     = [ "textNode", "numberNode" ]
    , streamWraps = clarinet.EVENTS.filter(function (ev) {
          return ev !== "error" && ev !== "end";
        })
    , S           = 0
    , Stream
    ;

  clarinet.STATE =
    { BEGIN                             : S++
    , VALUE                             : S++ // general stuff
    , OPEN_OBJECT                       : S++ // {
    , CLOSE_OBJECT                      : S++ // }
    , OPEN_ARRAY                        : S++ // [
    , CLOSE_ARRAY                       : S++ // ]
    , TEXT_ESCAPE                       : S++ // \ stuff
    , STRING                            : S++ // ""
    , END                               : S++ // No more stack
    , OPEN_KEY                          : S++ // , "a"
    , CLOSE_KEY                         : S++ // :
    , TRUE                              : S++ // r
    , TRUE2                             : S++ // u
    , TRUE3                             : S++ // e
    , FALSE                             : S++ // a
    , FALSE2                            : S++ // l
    , FALSE3                            : S++ // s
    , FALSE4                            : S++ // e
    , NULL                              : S++ // u
    , NULL2                             : S++ // l
    , NULL3                             : S++ // l
    , NUMBER_DECIMAL_POINT              : S++ // .
    , NUMBER_DIGIT                      : S++ // [0-9]
    , IGNORE                            : S++ // move along nothing to see
    , IGNORE_STRING                     : S++ // strings can have }] etc
    };

  // creates the 0 -> BEGIN association in clarinet.STATE (2 way lookup)
  for (var s_ in clarinet.STATE) clarinet.STATE[clarinet.STATE[s_]] = s_;

  // shortcut, reusing variable
  S = clarinet.STATE;

  // if this doesnt exist
  if (!Object.create) {
    Object.create = function (o) {
      function f () { this["__proto__"] = o; }
      f.prototype = o;
      return new f;
    };
  }

  // or this doesnt exist
  if (!Object.getPrototypeOf) {
    Object.getPrototypeOf = function (o) {
      return o["__proto__"];
    };
  }

  // or this, then create the artifacts
  if (!Object.keys) {
    Object.keys = function (o) {
      var a = [];
      for (var i in o) if (o.hasOwnProperty(i)) a.push(i);
      return a;
    };
  }

  // avoid buffering too much and hogging too much memory in your buffers
  function checkBufferLength (parser) {
    var maxAllowed = Math.max(clarinet.MAX_BUFFER_LENGTH, 10)
      , maxActual = 0
      ;
    for (var i = 0, l = buffers.length; i < l; i ++) {
      var len = parser[buffers[i]].length;
      if (len > maxAllowed) {
        switch (buffers[i]) {
          case "text":
            closeText(parser);
          break;

          default:
            error(parser, "Max buffer length exceeded: "+ buffers[i]);
        }
      }
      maxActual = Math.max(maxActual, len);
    }
    parser.bufferCheckPosition = (clarinet.MAX_BUFFER_LENGTH - maxActual)
                               + parser.position;
  }

  // clear all buffers
  function clearBuffers (parser) {
    for (var i = 0, l = buffers.length; i < l; i ++) {
      parser[buffers[i]] = "";
    }
  }

  // create a new parser
  function CParser (opt) {
    if (!(this instanceof CParser)) return new CParser (opt);

    var parser = this
      ;
    clearBuffers(parser);
    parser.q        = parser.c = parser.p = "";
    parser.opt      = opt || {};
    // undocumented for now, just in case someone asks for this
    parser.bufferCheckPosition = 
      parser.opt.bufferCheckPosition || clarinet.MAX_BUFFER_LENGTH;
    // is the parser closed?
    parser.closed   = false;
    parser.error    = null;
    parser.state    = S.BEGIN;
    // stack is a fast list cause we only push and shift
    // if fastlist is not available it will be a normal array
    // which also can push and shift
    parser.stack       = new fastlist();
    // deep counts the stack level, increments when you enter
    // a object or array and decrements when you leave and object or array
    // this is used by the `only` and `except` functionality
    parser.position    = parser.column = parser.deep = 0;
    // start on line 1, 0 didn't match with text editors
    parser.line        = 1;
    parser.selectFound = false;
    if(typeof parser.opt.select === 'string') {
      var index  = []
        , select = parser.opt.select
        ;
      if(select.indexOf('.') !== -1) {
        select.split('.').forEach(function (e){
          if(/\[\d+\]/.test(e))
            // array, position n
            index.push(['a', e.replace(/\[(\d+)\]/, "$1")]);
          // else if its an wildcard level
          else if (e === '*')
            index.push(['*']);
          // else its an object key
          else if(e !== '')
            index.push(['k', e]);
        });
      } else {
        if(/\[\d+\]/.test(select))
          index.push(['a', select.replace(/\[(\d+)\]/, "$1")]);
        else
          index.push(['k', select]);
      }
      parser.opt.select = index;
    }
    parser.opt.select = parser.opt.select || [];
    if(parser.opt.select.length > 0)
      parser.ignore   = parser.opt.select.length;
    else parser.ignore = 0;
    emit(parser, "onready");
  }

  CParser.prototype =
    { end    : function () { end(this); }
    , write  : write
    , resume : function () { this.error = null; return this; }
    , close  : function () { return this.write(null); }
    };

  try        { Stream = require("stream").Stream; }
  catch (ex) { Stream = function () {}; }

  function createStream (opt) { return new CStream(opt); }

  function CStream (opt) {
    if (!(this instanceof CStream)) return new CStream(opt);

    Stream.apply(me);

    this._parser = new CParser(opt);
    this.writable = true;
    this.readable = true;

    var me = this;

    this._parser.onend = function () { me.emit("end"); };
    this._parser.onerror = function (er) {
      me.emit("error", er);
      me._parser.error = null;
    };

    streamWraps.forEach(function (ev) {
      Object.defineProperty(me, "on" + ev,
        { get          : function () { return me._parser["on" + ev]; }
        , set          : function (h) {
            if (!h) {
              me.removeAllListeners(ev);
              me._parser["on"+ev] = h;
              return h;
            }
            me.on(ev, h);
          }
        , enumerable   : true
        , configurable : false
        });
    });
  }

  CStream.prototype = Object.create(Stream.prototype,
    { constructor: { value: CStream } });

  CStream.prototype.write = function (data) {
    this._parser.write(data.toString());
    this.emit("data", data);
    return true;
  };

  CStream.prototype.end = function (chunk) {
    if (chunk && chunk.length) this._parser.write(chunk.toString());
    this._parser.end();
    return true;
  };

  CStream.prototype.on = function (ev, handler) {
    var me = this;
    if (!me._parser["on"+ev] && streamWraps.indexOf(ev) !== -1) {
      me._parser["on"+ev] = function () {
        var args = arguments.length === 1 ? [arguments[0]]
                 : Array.apply(null, arguments);
        args.splice(0, 0, ev);
        me.emit.apply(me, args);
      };
    }
    return Stream.prototype.on.call(me, ev, handler);
  };

  function emit(parser, event, data) {
    if (parser[event]) {
      if(event === 'onend' || event === 'onready' 
                           || parser.deep >= parser.ignore) {
        if(clarinet.INFO) console.log('-- emit', event, data, parser.deep);
        parser[event](data);
      }
    }
  }

  function emitNode(parser, event, data) {
    if (parser.textNode) closeValue(parser);
    emit(parser, event, data);
  }

  function closeValue(parser, event) {
    parser.textNode = textopts(parser.opt, parser.textNode);
    if (parser.textNode) 
      emit(parser, (event ? event : "onvalue"), parser.textNode);
    parser.textNode = "";
  }

  function closeKey(parser, event) {
    // select the current level
    var sel  = parser.opt.select[parser.deep-1]
      // value is fired by arrays
      // key and open object are fired by keys
      , flag = event === 'onvalue' ? 'a' : 'k'
      ;
    // next we are going to try a value, regardless
    parser.state  = S.VALUE;
    // if they defined a selector
    if(typeof sel !== 'undefined') {
      parser.ignore   = parser.deep;
      // if it doesnt match the current level
      if (!(sel[0] === flag && sel[1] === parser.textNode))
        parser.state    = S.IGNORE;
      else if(parser.deep===parser.opt.select.length)
        parser.selectFound = true;
      parser.textNode = "";
    } else closeValue(parser, event);
  }

  function closeNumber(parser) {
    if (parser.numberNode) 
      emit(parser, "onvalue", parseFloat(parser.numberNode));
    parser.numberNode = "";
  }

  function textopts (opt, text) {
    if (opt.trim) text = text.trim();
    if (opt.normalize) text = text.replace(/\s+/g, " ");
    return text;
  }

  function error (parser, er) {
    closeValue(parser);
    er += "\nLine: "+parser.line+
          "\nColumn: "+parser.column+
          "\nChar: "+parser.c;
    er = new Error(er);
    parser.error = er;
    emit(parser, "onerror", er);
    return parser;
  }

  function end(parser) {
    if (!(parser.state === S.VALUE || parser.state === S.IGNORE))
      error(parser, "Unexpected end");
    closeValue(parser);
    parser.c      = "";
    parser.closed = true;
    emit(parser, "onend");
    CParser.call(parser, parser.opt);
    return parser;
  }

  function write (chunk) {
    var parser = this;
    if (this.error) throw this.error;
    if (parser.closed) return error(parser,
      "Cannot write after close. Assign an onready handler.");
    if (chunk === null || parser.selectFound) return end(parser);
    var i = 0, c = chunk[0], p = parser.p;
    //if (clarinet.DEBUG) console.log('write -> [' + chunk + ']');
    while (c) {
      p = c;
      parser.c = c = chunk.charAt(i++);
      // if chunk doesnt have next, like streaming char by char
      // this way we need to check if previous is really previous
      // if not we need to reset to what the parser says is the previous
      // from buffer
      if(p !== c ) parser.p = p;
      else p = parser.p;

      if(!c) break;

      if (clarinet.DEBUG) 
        console.log(i,c,clarinet.STATE[parser.state]
                   ,parser.deep,parser.ignore);
      parser.position ++;
      if (c === "\n") {
        parser.line ++;
        parser.column = 0;
      } else parser.column ++;
      switch (parser.state) {

        case S.BEGIN:
          if (c === "{") parser.state = S.OPEN_OBJECT;
          else if (c === "[") parser.state = S.OPEN_ARRAY;
          else if (c !== '\r' && c !== '\n' && c !== ' ' && c !== '\t') 
            error(parser, "Non-whitespace before {[.");
        continue;

        case S.OPEN_KEY:
        case S.OPEN_OBJECT:
          if (c === '\r' || c === '\n' || c === ' ' || c === '\t') continue;
          if(parser.state === S.OPEN_KEY) parser.stack.push(S.CLOSE_KEY);
          else {
            if(c === '}') {
              emit(parser, 'onopenobject');
              emit(parser, 'oncloseobject');
              parser.state = parser.stack.pop() || S.VALUE;
              continue;
            } else  {
              parser.deep++;
              parser.stack.push(S.CLOSE_OBJECT);
            }
          }
          if(c === '"') parser.state = S.STRING;
          else error(parser, "Malformed object key should start with \"");
        continue;

        case S.CLOSE_KEY:
        case S.CLOSE_OBJECT:
          if (c === '\r' || c === '\n' || c === ' ' || c === '\t') continue;
          var event = (parser.state === S.CLOSE_KEY) ? 'key' : 'object';
          if(c===':') {
            if(parser.state === S.CLOSE_OBJECT) {
              parser.stack.push(S.CLOSE_OBJECT);
              closeKey(parser, 'onopenobject');
            } else closeKey(parser, 'onkey');
          } else if (c==='}') {
            parser.state = parser.stack.pop() || S.VALUE;
            // write last value
            if (parser.textNode) closeValue(parser);
            // change deep
            parser.deep--;
            // emit close object if deep is still deep enough :)
            emit(parser, 'oncloseobject');
            if (parser.deep < parser.ignore)
              parser.state = S.IGNORE;
          } else if(c===',') {
            if(parser.state === S.CLOSE_OBJECT)
              parser.stack.push(S.CLOSE_OBJECT);
            closeValue(parser);
            parser.state  = S.OPEN_KEY;
          } else error(parser, 'Bad object');
        continue;

        case S.OPEN_ARRAY: // after an array there always a value
        case S.VALUE:
          if (c === '\r' || c === '\n' || c === ' ' || c === '\t') continue;
          if(parser.state===S.OPEN_ARRAY) {
            emit(parser, 'onopenarray');
            parser.state = S.VALUE;
            if(c === ']') {
              emit(parser, 'onclosearray');
              parser.state = parser.stack.pop() || S.VALUE;
              continue;
            } else {
              parser.deep++;
              parser.stack.push(S.CLOSE_ARRAY);
            }
          }
               if(c === '"') parser.state = S.STRING;
          else if(c === '{') parser.state = S.OPEN_OBJECT;
          else if(c === '[') parser.state = S.OPEN_ARRAY;
          else if(c === 't') parser.state = S.TRUE;
          else if(c === 'f') parser.state = S.FALSE;
          else if(c === 'n') parser.state = S.NULL;
          else if(c === '-') { // keep and continue
            parser.numberNode += c;
          } else if(c==='0') {
            parser.numberNode += c;
            parser.state = S.NUMBER_DIGIT;
          } else if('123456789'.indexOf(c) !== -1) {
            parser.numberNode += c;
            parser.state = S.NUMBER_DIGIT;
          } else               error(parser, "Bad value");
        continue;

        case S.CLOSE_ARRAY:
          if(c===',') {
            parser.stack.push(S.CLOSE_ARRAY);
            closeKey(parser, 'onvalue');
            parser.state  = S.VALUE;
          } else if (c===']') {
            if (parser.textNode) closeValue(parser);
            parser.deep--;
            emit(parser, 'onclosearray');
            parser.state = parser.stack.pop() || S.VALUE;
          } else if (c === '\r' || c === '\n' || c === ' ' || c === '\t')
              continue;
          else error(parser, 'Bad array');
        continue;

        case S.STRING:
          // thanks thejh, this is an about 50% performance improvement.
          var starti              = i-1
            , consecutive_slashes = parser.consecutive_slashes || 0
            , gaps                = new fastlist()
            ;
          while (c) {
            if (clarinet.DEBUG) 
              console.log(i,c,clarinet.STATE[parser.state],parser.deep);
            // if it seems like end of string
            // and we found slashes before
            // and those slashes an even number
            // -> this is not an escape its the end of the string
            if (c === '"' && 
               (consecutive_slashes === 0 || consecutive_slashes%2 ===0)) {
              parser.state = parser.stack.pop() || S.VALUE;
              break;
            }
            if (c === '\\') { 
              consecutive_slashes++;
              if(consecutive_slashes !== 0 && consecutive_slashes%2 !==0)
                gaps.push(i-1);
            }
            else {
              consecutive_slashes = 0;
            }
            parser.consecutive_slashes = consecutive_slashes;
            parser.position ++;
            if (c === "\n") {
              parser.line ++;
              parser.column = 0;
            } else parser.column ++;
            c = chunk.charAt(i++);
          }
          var e    = gaps.shift()
            , s    = starti
            ;
          while(typeof e === 'number') {
            parser.textNode += chunk.slice(s, e);
            s                = e+1;
            e                = gaps.shift();
          }
          parser.textNode += chunk.substring(s, i-1);
        continue;

        case S.TRUE:
          if (c==='')  continue; // strange buffers
          if (c==='r') parser.state = S.TRUE2;
          else error(parser, 'Invalid true started with t'+ c);
        continue;

        case S.TRUE2:
          if (c==='')  continue;
          if (c==='u') parser.state = S.TRUE3;
          else error(parser, 'Invalid true started with tr'+ c);
        continue;

        case S.TRUE3:
          if (c==='') continue;
          if(c==='e') {
            emit(parser, "onvalue", true);
            parser.state = parser.stack.pop() || S.VALUE;
          } else error(parser, 'Invalid true started with tru'+ c);
        continue;

        case S.FALSE:
          if (c==='')  continue;
          if (c==='a') parser.state = S.FALSE2;
          else error(parser, 'Invalid false started with f'+ c);
        continue;

        case S.FALSE2:
          if (c==='')  continue;
          if (c==='l') parser.state = S.FALSE3;
          else error(parser, 'Invalid false started with fa'+ c);
        continue;

        case S.FALSE3:
          if (c==='')  continue;
          if (c==='s') parser.state = S.FALSE4;
          else error(parser, 'Invalid false started with fal'+ c);
        continue;

        case S.FALSE4:
          if (c==='')  continue;
          if (c==='e') {
            emit(parser, "onvalue", false);
            parser.state = parser.stack.pop() || S.VALUE;
          } else error(parser, 'Invalid false started with fals'+ c);
        continue;

        case S.NULL:
          if (c==='')  continue;
          if (c==='u') parser.state = S.NULL2;
          else error(parser, 'Invalid null started with n'+ c);
        continue;

        case S.NULL2:
          if (c==='')  continue;
          if (c==='l') parser.state = S.NULL3;
          else error(parser, 'Invalid null started with nu'+ c);
        continue;

        case S.NULL3:
          if (c==='') continue;
          if(c==='l') {
            emit(parser, "onvalue", null);
            parser.state = parser.stack.pop() || S.VALUE;
          } else error(parser, 'Invalid null started with nul'+ c);
        continue;

        case S.NUMBER_DECIMAL_POINT:
          if(c==='.') {
            parser.numberNode += c;
            parser.state       = S.NUMBER_DIGIT;
          } else error(parser, 'Leading zero not followed by .');
        continue;

        case S.NUMBER_DIGIT:
          if('0123456789'.indexOf(c) !== -1) parser.numberNode += c;
          else if (c==='.') {
            if(parser.numberNode.indexOf('.')!==-1)
              error(parser, 'Invalid number has two dots');
            parser.numberNode += c;
          } else if (c==='e' || c==='E') {
            if(parser.numberNode.indexOf('e')!==-1 || 
               parser.numberNode.indexOf('E')!==-1 )
               error(parser, 'Invalid number has two exponential');
            parser.numberNode += c;
          } else if (c==="+" || c==="-") {
            if(!(p==='e' || p==='E'))
              error(parser, 'Invalid symbol in number');
            parser.numberNode += c;
          } else {
            closeNumber(parser);
            i--; // go back one
            parser.state = parser.stack.pop() || S.VALUE;
          }
        continue;

        case S.IGNORE:
          if (c === '\r' || c === '\n' || c === ' ' || c === '\t') continue;
          // stop
          if(parser.selectFound) return parser;
          if(c==='{' || c==='[')
            parser.deep++;
          else if(c===']' || c==='}')
            parser.deep--;
          else if(c===',' && parser.deep === parser.ignore)
            // need to go back a level cause the state transition except
            i--;
          else {
            if(c==='"') parser.state = S.IGNORE_STRING;
            continue;
          }
          if(parser.deep === parser.ignore)
            parser.state = parser.stack.pop() || S.VALUE;
        continue;

        case S.IGNORE_STRING:
          var cs = parser.consecutive_slashes || 0;
          if (c === '"' && (cs === 0 || cs%2 ===0)) {
            parser.state  = S.IGNORE;
            parser.cs     = 0;
            continue;
          }
          if (c === '\\') cs++;
          else            cs = 0;
          parser.consecutive_slashes = cs;
        continue;

        default:
          error(parser, "Unknown state: " + parser.state);
      }
    }
    if (parser.position >= parser.bufferCheckPosition)
      checkBufferLength(parser);
    return parser;
  }

})(typeof exports === "undefined" ? clarinet = {} : exports);