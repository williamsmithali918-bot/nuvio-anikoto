/* AniKoto provider for Nuvio
 *
 * AniKotoAPI v2.4.x flow:
 * search
 * -> episodes
 * -> decode server_ids
 * -> servers
 * -> stream
 * -> stream/resolve
 */

var API = "https://anikototvapi.vercel.app/api";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";


/* ---------------------------------------------------------
 * HTTP
 * --------------------------------------------------------- */

function fetchJson(url) {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    }
  }).then(function (response) {
    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status + " from " + url
      );
    }

    return response.json();
  });
}


/* ---------------------------------------------------------
 * Base64 decoder
 *
 * server_ids returned by AniKotoAPI are base64 encoded.
 * Avoid relying on atob() because Nuvio's JS runtime
 * compatibility can vary.
 * --------------------------------------------------------- */

var BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789+/";

function decodeBase64(input) {
  var str = String(input || "")
    .replace(/[\r\n\s]/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (str.length % 4 !== 0) {
    str += "=";
  }

  var output = "";
  var i = 0;

  while (i < str.length) {
    var c1 = BASE64_CHARS.indexOf(str.charAt(i++));
    var c2 = BASE64_CHARS.indexOf(str.charAt(i++));
    var c3 = BASE64_CHARS.indexOf(str.charAt(i++));
    var c4 = BASE64_CHARS.indexOf(str.charAt(i++));

    if (c1 < 0 || c2 < 0) {
      break;
    }

    var n =
      (c1 << 18) |
      (c2 << 12) |
      ((c3 < 0 ? 0 : c3) << 6) |
      (c4 < 0 ? 0 : c4);

    output += String.fromCharCode(
      (n >> 16) & 255
    );

    if (c3 >= 0 && str.charAt(i - 2) !== "=") {
      output += String.fromCharCode(
        (n >> 8) & 255
      );
    }

    if (c4 >= 0 && str.charAt(i - 1) !== "=") {
      output += String.fromCharCode(
        n & 255
      );
    }
  }

  return output;
}


/* ---------------------------------------------------------
 * Title matching
 * --------------------------------------------------------- */

function normalizeTitle(value) {
  return String(value || "")
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

  return matches / Math.max(
    aw.length,
    bw.length
  );
}


/* ---------------------------------------------------------
 * Cinemeta metadata
 * --------------------------------------------------------- */

function getTitle(tmdbId) {
  return fetchJson(
    "https://v3-cinemeta.strem.io/meta/tv/tmdb:" +
    encodeURIComponent(String(tmdbId)) +
    ".json"
  ).then(function (data) {
    if (!data || !data.meta) {
      throw new Error(
        "Cinemeta metadata not found"
      );
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


/* ---------------------------------------------------------
 * AniKoto search
 * --------------------------------------------------------- */

function searchAnime(title) {
  return fetchJson(
    API +
    "/search?keyword=" +
    encodeURIComponent(title)
  ).then(function (data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data;
    }

    if (
      data.results &&
      Array.isArray(data.results.data)
    ) {
      return data.results.data;
    }

    if (
      data.results &&
      Array.isArray(data.results.results)
    ) {
      return data.results.results;
    }

    if (Array.isArray(data.results)) {
      return data.results;
    }

    if (
      data.data &&
      Array.isArray(data.data.data)
    ) {
      return data.data.data;
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    return [];
  });
}

function findAnime(results, title) {
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var item = results[i];

    var itemTitle =
      item.title ||
      item.name ||
      item.anime_title ||
      item.japaneseTitle ||
      item.japanese_title ||
      "";

    var score = similarity(
      itemTitle,
      title
    );

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

function getAnimeId(item) {
  if (!item) {
    return null;
  }

  return (
    item.animeId ||
    item.anime_id ||
    item.id ||
    null
  );
}

function getAnimeSlug(item) {
  if (!item) {
    return null;
  }

  return (
    item.slug ||
    item.anime_slug ||
    item.animeSlug ||
    null
  );
}


/* ---------------------------------------------------------
 * Episodes
 * --------------------------------------------------------- */

function getEpisodes(animeKey) {
  return fetchJson(
    API +
    "/episodes/" +
    encodeURIComponent(String(animeKey))
  ).then(function (data) {
    if (!data) {
      return {
        episodes: [],
        slug: null
      };
    }

    if (Array.isArray(data)) {
      return {
        episodes: data,
        slug: null
      };
    }

    if (
      data.results &&
      Array.isArray(data.results.episodes)
    ) {
      return {
        episodes: data.results.episodes,
        slug: data.results.slug || null
      };
    }

    if (
      data.data &&
      Array.isArray(data.data.episodes)
    ) {
      return {
        episodes: data.data.episodes,
        slug: data.data.slug || null
      };
    }

    if (Array.isArray(data.episodes)) {
      return {
        episodes: data.episodes,
        slug: data.slug || null
      };
    }

    if (Array.isArray(data.data)) {
      return {
        episodes: data.data,
        slug: data.slug || null
      };
    }

    return {
      episodes: [],
      slug: null
    };
  });
}

function findEpisode(episodes, episodeNumber) {
  for (var i = 0; i < episodes.length; i++) {
    var episode = episodes[i];

    var number =
      episode.episode_no ||
      episode.episode ||
      episode.number ||
      episode.ep ||
      episode.episode_number;

    if (
      String(number) ===
      String(episodeNumber)
    ) {
      return episode;
    }
  }

  if (
    episodeNumber >= 1 &&
    episodeNumber <= episodes.length
  ) {
    return episodes[
      episodeNumber - 1
    ];
  }

  return null;
}


/* ---------------------------------------------------------
 * Servers
 * --------------------------------------------------------- */

function getDecodedServerIds(serverIds) {
  if (!serverIds) {
    return null;
  }

  var value = String(serverIds)
    .replace(/^"+|"+$/g, "")
    .trim();

  /*
   * v2.x documents server_ids as base64.
   * If it already looks decoded, keep it.
   */
  if (
    value.indexOf(":") !== -1 &&
    /^[0-9:]+$/.test(value)
  ) {
    return value;
  }

  var decoded;

  try {
    decoded = decodeBase64(value);
  } catch (error) {
    decoded = "";
  }

  if (
    decoded &&
    decoded.indexOf(":") !== -1
  ) {
    return decoded;
  }

  /*
   * Some deployments may already return
   * a plain ID/list.
   */
  return value;
}

function getServers(serverIds) {
  var ids = getDecodedServerIds(
    serverIds
  );

  if (!ids) {
    return Promise.resolve([]);
  }

  return fetchJson(
    API +
    "/servers?ids=" +
    encodeURIComponent(ids)
  ).then(function (data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data;
    }

    if (
      data.results &&
      Array.isArray(data.results)
    ) {
      return data.results;
    }

    if (
      data.data &&
      Array.isArray(data.data)
    ) {
      return data.data;
    }

    return [];
  });
}


/* ---------------------------------------------------------
 * Stream embed info
 * --------------------------------------------------------- */

function getStreamInfo(linkId) {
  return fetchJson(
    API +
    "/stream?id=" +
    encodeURIComponent(String(linkId))
  ).then(function (data) {
    if (!data) {
      return null;
    }

    if (
      data.results &&
      data.results.url
    ) {
      return data.results;
    }

    if (
      data.result &&
      data.result.url
    ) {
      return data.result;
    }

    if (
      data.data &&
      data.data.url
    ) {
      return data.data;
    }

    if (data.url) {
      return data;
    }

    return null;
  });
}


/* ---------------------------------------------------------
 * Resolve actual m3u8/mp4
 * --------------------------------------------------------- */

function resolveStream(linkId, slug) {
  var url =
    API +
    "/stream/resolve?id=" +
    encodeURIComponent(String(linkId));

  if (slug) {
    url +=
      "&slug=" +
      encodeURIComponent(String(slug));
  }

  return fetchJson(url)
    .then(function (data) {
      if (!data) {
        return null;
      }

      if (
        data.results &&
        data.results.url
      ) {
        return data.results;
      }

      if (
        data.result &&
        data.result.url
      ) {
        return data.result;
      }

      if (
        data.data &&
        data.data.url
      ) {
        return data.data;
      }

      if (data.url) {
        return data;
      }

      return null;
    });
}


/* ---------------------------------------------------------
 * Stream quality
 * --------------------------------------------------------- */

function detectFormat(url, type) {
  if (
    type &&
    String(type).toLowerCase() === "hls"
  ) {
    return "m3u8";
  }

  if (
    /\.m3u8([?#]|$)/i.test(
      String(url || "")
    )
  ) {
    return "m3u8";
  }

  return "mp4";
}

function extractQuality(stream) {
  if (!stream) {
    return "Auto";
  }

  if (stream.quality) {
    return String(stream.quality);
  }

  if (stream.resolution) {
    return String(stream.resolution);
  }

  if (
    stream.height &&
    !isNaN(parseInt(stream.height, 10))
  ) {
    return (
      String(
        parseInt(stream.height, 10)
      ) +
      "p"
    );
  }

  return "Auto";
}


/* ---------------------------------------------------------
 * Build Nuvio stream
 * --------------------------------------------------------- */

function makeStream(
  resolved,
  server,
  episodeNumber
) {
  if (
    !resolved ||
    !resolved.url
  ) {
    return null;
  }

  var url = String(
    resolved.url
  );

  var format = detectFormat(
    url,
    resolved.type
  );

  var serverName =
    server &&
    (
      server.name ||
      server.type
    )
      ? (
          server.name ||
          server.type
        )
      : "AniKoto";

  var quality =
    extractQuality(
      resolved
    );

  /*
   * If the resolver doesn't provide a
   * quality, don't pretend the server name
   * is a resolution.
   */
  if (
    quality === "Auto" &&
    server &&
    server.name
  ) {
    quality = "Auto";
  }

  return {
    name: "AniKoto",

    title:
      "AniKoto • E" +
      String(episodeNumber) +
      " • " +
      String(serverName),

    url: url,

    quality: quality,

    format: format,

    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://anikoto.cz/"
    }
  };
}


/* ---------------------------------------------------------
 * Main Nuvio provider
 * --------------------------------------------------------- */

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  if (!tmdbId) {
    return Promise.resolve([]);
  }

  if (
    mediaType &&
    mediaType !== "tv"
  ) {
    return Promise.resolve([]);
  }

  if (
    episode === null ||
    episode === undefined
  ) {
    return Promise.resolve([]);
  }

  var episodeNumber =
    parseInt(
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
  var anime;
  var episodeData;
  var selectedEpisode;
  var animeSlug;

  return getTitle(tmdbId)

    /* Search */
    .then(function (resolvedTitle) {
      title = resolvedTitle;

      return searchAnime(
        resolvedTitle
      );
    })

    /* Select anime */
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

      animeSlug =
        getAnimeSlug(anime);

      var animeKey =
        getAnimeId(anime) ||
        animeSlug;

      if (!animeKey) {
        throw new Error(
          "AniKoto anime ID/slug missing"
        );
      }

      return getEpisodes(
        animeKey
      );
    })

    /* Select episode */
    .then(function (data) {
      episodeData = data;

      /*
       * Prefer slug returned by /episodes.
       * Fall back to search result slug.
       */
      if (
        data.slug &&
        !animeSlug
      ) {
        animeSlug =
          data.slug;
      }

      selectedEpisode =
        findEpisode(
          data.episodes,
          episodeNumber
        );

      if (!selectedEpisode) {
        throw new Error(
          "Episode " +
          String(episodeNumber) +
          " not found"
        );
      }

      if (
        !selectedEpisode.server_ids
      ) {
        throw new Error(
          "Episode has no server_ids"
        );
      }

      return getServers(
        selectedEpisode.server_ids
      );
    })

    /* Select servers */
    .then(function (servers) {
      if (!servers.length) {
        throw new Error(
          "No AniKoto servers available"
        );
      }

      var usable =
        servers.filter(
          function (server) {
            return (
              server &&
              server.link_id
            );
          }
        );

      if (!usable.length) {
        throw new Error(
          "No AniKoto link_id values"
        );
      }

      /*
       * Try every available server.
       * Limit to 6 so a broken server cannot
       * create excessive requests.
       */
      return Promise.all(
        usable
          .slice(0, 6)
          .map(function (server) {

            return getStreamInfo(
              server.link_id
            )
              .then(function (info) {

                /*
                 * The /stream endpoint returns
                 * an embed URL. We primarily use
                 * /stream/resolve for the actual
                 * playable URL.
                 */
                return resolveStream(
                  server.link_id,
                  animeSlug
                )
                  .then(function (resolved) {

                    /*
                     * Resolver succeeded.
                     */
                    if (resolved) {
                      return makeStream(
                        resolved,
                        server,
                        episodeNumber
                      );
                    }

                    /*
                     * Rare fallback: if /stream
                     * itself already returned a
                     * playable URL, use it.
                     */
                    if (
                      info &&
                      info.url &&
                      (
                        /\.m3u8/i.test(
                          String(info.url)
                        ) ||
                        /\.mp4/i.test(
                          String(info.url)
                        )
                      )
                    ) {
                      return makeStream(
                        {
                          url: info.url,
                          type:
                            /\.m3u8/i.test(
                              String(info.url)
                            )
                              ? "hls"
                              : "mp4"
                        },
                        server,
                        episodeNumber
                      );
                    }

                    return null;
                  });

              })
              .catch(function () {
                return null;
              });
          })
      );
    })

    /* Remove failed servers */
    .then(function (streams) {
      var output = [];
      var seen = {};

      for (
        var i = 0;
        i < streams.length;
        i++
      ) {
        var stream = streams[i];

        if (
          !stream ||
          !stream.url
        ) {
          continue;
        }

        var key =
          String(stream.url);

        if (seen[key]) {
          continue;
        }

        seen[key] = true;
        output.push(stream);
      }

      return output;
    })

    /* Never crash the Nuvio provider */
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
