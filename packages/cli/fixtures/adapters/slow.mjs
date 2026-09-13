console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "test" }));
// Simulate a long-running worker so tests can prove cancel() actually stops it
// instead of waiting out this timer.
setTimeout(() => {
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done" }));
}, 8000);
