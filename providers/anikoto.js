/* AniKoto provider for Nuvio */

var API = "https://anikototvapi.vercel.app/api";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 " +
  "Chrome/131.0 Mobile Safari/537.36";

function fetchJson(url) {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    }
  }).then(function (r) {
    if (!r.ok) {
      throw new Error("HTTP " + r.status);
    }

    return r.json();
  });
}

function normalizeTitle(s) {
  return String(s || "")
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

  if (!aa || !bb) return 0;
  if (aa === bb) return 1;

  if (
    aa.indexOf(bb) !== -1 ||
    bb.indexOf(aa) !== -1
  ) {
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

function getTitle(tmdbId) {
  return fetchJson(
    "https://v3-cinemeta.strem.io/meta/tv/tmdb:" +
    encodeURIComponent(String(tmdbId)) +
    ".json"
  ).then(function (d) {
    if (!d || !d.meta) {
      throw new Error("Cinemeta metadata not found");
    }

    return (
      d.meta.name ||
      d.meta.title ||
      d.meta.originalName ||
      d.meta.original_title ||
      ""
    );
  });
}

function searchAnime(title) {
  return fetchJson(
    API +
    "/search?keyword=" +
    encodeURIComponent(title)
  ).then(function (d) {
    if (!d) return [];

    if (Array.isArray(d)) return d;

    if (
      d.results &&
      Array.isArray(d.results.data)
    ) {
      return d.results.data;
    }

    if (
      d.results &&
      Array.isArray(d.results.results)
    ) {
      return d.results.results;
    }

    if (Array.isArray(d.results)) {
      return d.results;
    }

    if (
      d.data &&
      Array.isArray(d.data.data)
    ) {
      return d.data.data;
    }

    if (Array.isArray(d.data)) {
      return d.data;
    }

    return [];
  });
}

function findAnime(results, title) {
  var best = null;
  var score = 0;

  for (var i = 0; i < results.length; i++) {
    var item = results[i];

    var itemTitle =
      item.title ||
      item.name ||
      item.anime_title ||
      item.japaneseTitle ||
      "";

    var s = similarity(itemTitle, title);

    if (s > score) {
      score = s;
      best = item;
    }
  }

  return best;
}

function getAnimeKey(item) {
  if (!item) return null;

  return (
    item.animeId ||
    item.anime_id ||
    item.id ||
    item.slug ||
    null
  );
}

function getEpisodes(animeKey) {
  return fetchJson(
    API +
    "/episodes/" +
    encodeURIComponent(String(animeKey))
  ).then(function (d) {
    if (!d) return [];

    if (Array.isArray(d)) return d;

    if (
      d.results &&
      Array.isArray(d.results.episodes)
    ) {
      return d.results.episodes;
    }

    if (
      d.results &&
      Array.isArray(d.results.data)
    ) {
      return d.results.data;
    }

    if (Array.isArray(d.episodes)) {
      return d.episodes;
    }

    if (Array.isArray(d.data)) {
      return d.data;
    }

    if (
      d.data &&
      Array.isArray(d.data.episodes)
    ) {
      return d.data.episodes;
    }

    return [];
  });
}

function findEpisode(episodes, number) {
  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];

    var n =
      ep.episode_no ||
      ep.episode ||
      ep.number ||
      ep.ep ||
      ep.episode_number;

    if (String(n) === String(number)) {
      return ep;
    }
  }

  if (
    number >= 1 &&
    number <= episodes.length
  ) {
    return episodes[number - 1];
  }

  return null;
}

function getServers(serverIds) {
  return fetchJson(
    API +
    "/servers?ids=" +
    encodeURIComponent(String(serverIds))
  ).then(function (d) {
    if (!d) return [];

    if (Array.isArray(d)) return d;

    if (
      d.results &&
      Array.isArray(d.results)
    ) {
      return d.results;
    }

    if (
      d.data &&
      Array.isArray(d.data)
    ) {
      return d.data;
    }

    return [];
  });
}

function getStream(linkId) {
  return fetchJson(
    API +
    "/stream?id=" +
    encodeURIComponent(String(linkId))
  ).then(function (d) {
    if (!d) return null;

    if (
      d.results &&
      d.results.url
    ) {
      return d.results;
    }

    if (
      d.result &&
      d.result.url
    ) {
      return d.result;
    }

    if (
      d.data &&
      d.data.url
    ) {
      return d.data;
    }

    if (d.url) {
      return d;
    }

    return null;
  });
}

function makeStream(
  stream,
  serverName,
  episodeNumber
) {
  if (!stream || !stream.url) {
    return null;
  }

  var url = String(stream.url);

  var format =
    /\.m3u8([?#]|$)/i.test(url)
      ? "m3u8"
      : "mp4";

  return {
    name: "AniKoto",

    title:
      "AniKoto • E" +
      String(episodeNumber) +
      " • " +
      String(serverName || "Stream"),

    url: url,

    quality:
      String(serverName || "Auto"),

    format: format,

    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://anikoto.cz/"
    }
  };
}

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  if (
    !tmdbId ||
    mediaType === "movie" ||
    episode === null ||
    episode === undefined
  ) {
    return Promise.resolve([]);
  }

  var episodeNumber =
    parseInt(episode, 10);

  if (
    isNaN(episodeNumber) ||
    episodeNumber < 1
  ) {
    return Promise.resolve([]);
  }

  var title;
  var anime;
  var selected;

  return getTitle(tmdbId)

    .then(function (t) {
      title = t;
      return searchAnime(t);
    })

    .then(function (results) {
      anime = findAnime(
        results,
        title
      );

      if (!anime) {
        throw new Error(
          "AniKoto anime not found"
        );
      }

      return getEpisodes(
        getAnimeKey(anime)
      );
    })

    .then(function (episodes) {
      selected = findEpisode(
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

      if (!selected.server_ids) {
        throw new Error(
          "AniKoto server_ids missing"
        );
      }

      return getServers(
        selected.server_ids
      );
    })

    .then(function (servers) {
      if (!servers.length) {
        throw new Error(
          "AniKoto servers unavailable"
        );
      }

      var usable =
        servers.filter(function (s) {
          return s && s.link_id;
        });

      if (!usable.length) {
        throw new Error(
          "AniKoto link_id missing"
        );
      }

      return Promise.all(
        usable
          .slice(0, 4)
          .map(function (server) {
            return getStream(
              server.link_id
            )
              .then(function (stream) {
                return makeStream(
                  stream,
                  server.name,
                  episodeNumber
                );
              })
              .catch(function () {
                return null;
              });
          })
      );
    })

    .then(function (streams) {
      return streams.filter(
        function (s) {
          return !!s;
        }
      );
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
