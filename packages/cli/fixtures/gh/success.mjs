const args = process.argv.slice(2);
if (args[0] === "repo" && args[1] === "view") {
  console.log("main");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  console.log("https://github.com/example/example/pull/1");
  process.exit(0);
}
process.exit(1);
