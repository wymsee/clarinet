/* eslint-disable no-console */
const { Suite } = require("benchmark");
const { Listener } = require("./listener");
const clarinet = require("clarinet-last-published");
const mine = require("..");

const oldParser = clarinet.parser();
const oldListener = new Listener(oldParser);

const newParser = mine.parser();
const newListener = new Listener(newParser);

const suites =
  ["creationix", "npm", "twitter", "wikipedia"]
    .map((name) => {
      // eslint-disable-next-line security/detect-non-literal-require
      return { name, json: JSON.stringify(require(`../samples/${name}.json`)) };
    });

for (const { name, json } of suites) {
  new Suite("name")
    // .add(`native-${name}`, () => JSON.parse(json))
    .add(`old-${name}`, () => {
      oldListener.reset();
      oldParser.write(json);
      oldParser.close();
      oldListener.check();
    })
    .add(`new-${name}`, () => {
      newListener.reset();
      newParser.write(json);
      newParser.close();
      newListener.check();
    })
    .on("cycle", (event) => {
      console.log(String(event.target));
    })
    .on("error", (event) => {
      console.error(String(event.target.error));
    })
    .on("complete", (event) => {
      console.log(
        `Fastest is ${event.currentTarget.filter("fastest").map("name")}\n`
      );
    })
    .run();
}