/*
 * AniKoto provider for Nuvio
 * https://anikoto.cz
 *
 * Uses the public AniKotoAPI backend.
 */

var API = "https://anikototvapi.vercel.app/api";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

function fetchJson(url) {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    }
  }).then(function (response) {
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return response.json();
  });
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[-_:,.!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  var aa = normalizeTitle(a);
  var bb = normalizeTitle(b);

  if (!aa || !bb) {
    return 0;
  }

  if (aa === bb) {
    return 1;
  }

  if (aa.indexOf(bb) !== -1 || bb.indexOf(aa) !== -1) {
    return 0.9;
  }

  var aw = aa.split(" ");
  var bw = bb.split(" ");
  var matches = 0;

  for (var i = 0; i < aw.length; i++) {
    if (bw.indexOf(aw[i]) !== -1) {
      matches++;
    }
  }

  return matches / Math.max(aw.length, bw.length);
}

/*
 * Get the title from Cinemeta.
 */
function getTitle(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";

  return fetchJson(
    "https://v3-cinemeta.strem.io/meta/" +
    type +
    "/tmdb:" +
    encodeURIComponent(String(tmdbId)) +
    ".json"
  ).then(function (data) {
    if (!data || !data.meta) {
      throw new Error("Cinemeta metadata not found");
    }

    return (
      data.meta.name ||
      data.meta.title ||
      data.meta.originalName ||
      data.meta.original_title ||
      ""
    );
  });
}

/*
 * Search AniKoto.
 */
function searchAnime(title) {
  return fetchJson(
    API +
    "/search?keyword=" +
    encodeURIComponent(title)
  ).then(function (data) {
    if (!data) {
      return [];
    }

    /*
     * AniKotoAPI versions use different response
     * wrappers, so support the common ones.
     */
    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    if (data.data && Array.isArray(data.data.data)) {
      return data.data.data;
    }

    if (Array.isArray(data.results)) {
      return data.results;
    }

    return [];
  });
}

/*
 * Find the best AniKoto result.
 */
function findBestResult(results, title) {
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var item = results[i];

    var itemTitle =
      item.title ||
      item.name ||
      item.anime_title ||
      item.jname ||
      "";

    var score = similarity(itemTitle, title);

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

/*
 * Extract a slug/id from a search result.
 */
function getAnimeId(item) {
  if (!item) {
    return null;
  }

  return (
    item.id ||
    item.anime_id ||
    item.slug ||
    item.animeId ||
    null
  );
}

/*
 * Get episodes.
 */
function getEpisodes(animeId) {
  return fetchJson(
    API +
    "/episodes/" +
    encodeURIComponent(String(animeId))
  ).then(function (data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    if (data.data && Array.isArray(data.data.episodes)) {
      return data.data.episodes;
    }

    if (Array.isArray(data.episodes)) {
      return data.episodes;
    }

    return [];
  });
}

/*
 * Find the requested episode.
 */
function findEpisode(episodes, episodeNumber) {
  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];

    var number =
      ep.number ||
      ep.episode ||
      ep.ep ||
      ep.episode_number ||
      null;

    if (String(number) === String(episodeNumber)) {
      return ep;
    }
  }

  /*
   * Some API versions return the episode index
   * as the array position.
   */
  if (
    episodeNumber >= 1 &&
    episodeNumber <= episodes.length
  ) {
    return episodes[episodeNumber - 1];
  }

  return null;
}

/*
 * Get stream directly from AniKotoAPI.
 */
function getStream(episode) {
  var id =
    episode.id ||
    episode.episode_id ||
    episode.ep_id ||
    episode.link_id ||
    episode.server_id ||
    null;

  if (!id) {
    return Promise.resolve(null);
  }

  return fetchJson(
    API +
    "/stream?id=" +
    encodeURIComponent(String(id))
  ).then(function (data) {
    if (!data) {
      return null;
    }

    /*
     * Handle common response formats.
     */
    if (data.url) {
      return data;
    }

    if (data.data && data.data.url) {
      return data.data;
    }

    if (data.result && data.result.url) {
      return data.result;
    }

    return null;
  });
}

/*
 * Convert the API stream into a Nuvio stream.
 */
function makeStream(stream, episodeNumber) {
  if (!stream || !stream.url) {
    return null;
  }

  var quality =
    stream.quality ||
    stream.resolution ||
    "Unknown";

  return {
    name: "AniKoto",

    title:
      "AniKoto • " +
      "E" +
      String(episodeNumber) +
      " • " +
      String(quality),

    url: stream.url,

    quality: String(quality),

    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://anikoto.cz/"
    }
  };
}

/*
 * Nuvio entry point.
 */
function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  if (!tmdbId) {
    return Promise.resolve([]);
  }

  if (mediaType === "movie") {
    return Promise.resolve([]);
  }

  if (
    episode === null ||
    episode === undefined
  ) {
    return Promise.resolve([]);
  }

  var episodeNumber = parseInt(
    episode,
    10
  );

  if (
    isNaN(episodeNumber) ||
    episodeNumber < 1
  ) {
    return Promise.resolve([]);
  }

  var title;

  return getTitle(
    tmdbId,
    mediaType
  )
    .then(function (value) {
      title = value;

      return searchAnime(title);
    })
    .then(function (results) {
      if (!results.length) {
        throw new Error(
          "AniKoto anime not found"
        );
      }

      var anime = findBestResult(
        results,
        title
      );

      if (!anime) {
        throw new Error(
          "No matching AniKoto anime"
        );
      }

      var animeId =
        getAnimeId(anime);

      if (!animeId) {
        throw new Error(
          "AniKoto anime ID missing"
        );
      }

      return getEpisodes(
        animeId
      );
    })
    .then(function (episodes) {
      var selected = findEpisode(
        episodes,
        episodeNumber
      );

      if (!selected) {
        throw new Error(
          "Episode " +
          episodeNumber +
          " not found"
        );
      }

      return getStream(
        selected
      );
    })
    .then(function (stream) {
      var result =
        makeStream(
          stream,
          episodeNumber
        );

      if (!result) {
        return [];
      }

      return [result];
    })
    .catch(function (error) {
      console.log(
        "[AniKoto] " +
        String(error)
      );

      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
