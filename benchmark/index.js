const { Suite } = require("benchmark");
const assert = require("assert");

const clarinet = require("clarinet-last-published");
const mine = require("..");

/**
 * Listener that counts all events emitted by the Clarinet.js parser and sanity checks the totals.
 * This defeats potential dead code elimination and helps make the benchmark more realistic.
 */
class Listener {
  constructor(parser) {
    this.reset();
    
    parser.onready = () => {
      this.ready++;
    };
    
    parser.onopenobject = name => {
      this.openObject++;
      name === undefined || parser.onkey(name);
    };
    
    parser.onkey = name => {
      this.key++;
      assert(name !== "𝓥𝓸𝓵𝓭𝓮𝓶𝓸𝓻𝓽");
    };
    
    parser.oncloseobject = () => {
      this.closeObject++;
    };
    
    parser.onopenarray = () => {
      this.openArray++;
    };
    
    parser.onclosearray = () => {
      this.closeArray++;
    };
    
    parser.onvalue = () => {
      this.value++;
    };
    
    parser.onerror = () => {
      this.error++;
    };
    
    parser.onend = () => {
      this.end++;
    };
  }

  /** Resets the counts between iterations. */
  reset() {
    this.ready = 0;
    this.openObject = 0;
    this.key = 0;
    this.closeObject = 0;
    this.openArray = 0;
    this.closeArray = 0;
    this.value = 0;
    this.error = 0;
    this.end = 0;
  }

  /** Sanity checks the total event counts. */
  check() {
    assert(this.ready === 1);
    assert(this.end === 1);
    assert(this.error === 0);
    assert(this.value + this.openObject + this.openArray >= this.key);
    assert(this.openObject === this.closeObject);
    assert(this.openArray === this.closeArray);
  }
}

const old_parser = clarinet.parser();
const old_listener = new Listener(old_parser);

const new_parser = mine.parser();
const new_listener = new Listener(new_parser);

const suites =
  ["creationix", "npm", "twitter", "wikipedia"]
    .map(name => {
      return { name, json: JSON.stringify(require(`../samples/${name}.json`)) };
    });

for (const { name, json } of suites) {
  new Suite("name")
    // .add(`native-${name}`, () => JSON.parse(json))
    .add(`old-${name}`, () => {
      old_listener.reset();
      old_parser.write(json);
      old_parser.close();
      old_listener.check();
    })
    .add(`new-${name}`, () => {
      new_listener.reset();
      new_parser.write(json);
      new_parser.close();
      new_listener.check();
    })
    .on("cycle", event => {
      console.log(String(event.target));
    })
    .on("error", event => {
      console.error(String(event.target.error));
    })
    .on("complete", event => {
      console.log(
        `Fastest is ${event.currentTarget.filter("fastest").map("name")}\n`
      );
    })
    .run();
}