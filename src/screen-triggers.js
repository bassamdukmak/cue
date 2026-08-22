const VISIBLE_MATERIAL = /\b(?:this slide|on the screen|as you can see|these numbers|this chart|look at|shown here)\b/i;
const NUMBER_CLAIM = /\b(?:\d+(?:\.\d+)?%?\b.{0,48}\b(?:is|are|was|were|will|grew|declined|increased|decreased|revenue|margin|users|sales|costs?)\b|(?:is|are|was|were|grew|declined|increased|decreased|revenue|margin|users|sales|costs?)\b.{0,48}\b\d+(?:\.\d+)?%?\b)/i;

function shouldCheckScreen(recentTurns) {
  return (recentTurns || []).slice(-4).some((turn) => {
    if (!turn || !['them', 'you'].includes(turn.channel || turn.role)) return false;
    const text = String(turn.text || '');
    return VISIBLE_MATERIAL.test(text) || NUMBER_CLAIM.test(text);
  });
}

module.exports = { shouldCheckScreen };
