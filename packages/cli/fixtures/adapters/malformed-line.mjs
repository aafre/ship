console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "test" }));
console.log("not json {{{");
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "test" }));
