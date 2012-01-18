// print stuff related to "nano"
var fs             = require('fs')
  , clarinet       = require('../clarinet')
  , parser         = clarinet.parser()

var depth = 0;
var print = true;

parser.onopenobject = function(name) {
  depth++;
  if (print) console.log('OPEN WITH KEY: '+name);
  return handleKey(name);
};

function handleKey(name) {
  if (name!=='nano' && depth === 1) {
    // IGNORE
    return true/*!!!*/;
  } else if (name==='nano' && depth === 1) {
    print = true
  }
  //if (depth === 2) console.log(depth+' KEY: '+name);
  return false;
}

parser.oncloseobject = function() {
  depth--;
  if (print) {
    console.log('CLOSE');
    if (depth === 1) print = false
  }
};

parser.onkey = function(name) {
  if (print) console.log('KEY: '+name)
  return handleKey(name)
};

parser.onvalue = function(value) {
  if (print) console.log('VALUE: '+value);
};

var inStream = fs.createReadStream(__dirname + '/npm.json', {encoding: 'utf8'})

inStream.on('data', function(chunk) {
  parser.write(chunk)
})
