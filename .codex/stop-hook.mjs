process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ systemMessage: 'remote-codex hook ran' }));
});
