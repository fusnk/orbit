# Example addon

A tiny Stremio-protocol addon with no dependencies, for trying Orbit end to end without any third-party addon. It serves a catalog, metadata and streams for public-domain and Creative Commons films, one "series" made of the Blender open movies (to test episodes), and generated test subtitles.

## Run it

```sh
node examples/addon/server.js
```

It listens on `http://127.0.0.1:7000` (set `PORT` to change the port). It only binds to this PC: Orbit allows plain `http` addons solely on `127.0.0.1`.

In Orbit, open **Addons** in the sidebar and install `http://127.0.0.1:7000/manifest.json`.

## The films

Every film is public domain or Creative Commons licensed. Each CC film credits its authors and licence in its description, as the licence requires; see `films.js`.
