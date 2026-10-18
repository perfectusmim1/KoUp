const fs = require('fs');

async function getRealImdbRating(imdbId, contentType) {
  const types = contentType === 'film' ? ['movie', 'series'] : ['series', 'movie'];
  for (const t of types) {
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${t}/${imdbId}.json`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith('{')) {
          const data = JSON.parse(text);
          const r = data?.meta?.imdbRating;
          if (r && Number(r) > 0) return Number(Number(r).toFixed(1));
        }
      }
    } catch {}
  }
  return null;
}

// Export for usage
module.exports = { getRealImdbRating };
