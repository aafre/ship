console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "test", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }));
