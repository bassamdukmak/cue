let hasSeenThemTurn = false;

function shouldScheduleAutoSuggest(channel) {
  if (channel === 'them') {
    hasSeenThemTurn = true;
    return true;
  }
  return channel === 'you' && !hasSeenThemTurn;
}

function resetAutoSuggestTrigger() {
  hasSeenThemTurn = false;
}

module.exports = { shouldScheduleAutoSuggest, resetAutoSuggestTrigger };
