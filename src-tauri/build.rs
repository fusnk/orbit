fn main() {
    println!("cargo:rustc-check-cfg=cfg(fuzzing)");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        // Build against the distribution's library, never a bundled Windows DLL.
        let mpv = pkg_config::Config::new().atleast_version("2.0").probe("mpv").expect("install libmpv-dev and pkg-config to build Orbit on Linux");
        pkg_config::Config::new().probe("gl").expect("install libgl-dev to build Orbit on Linux");
        pkg_config::Config::new().probe("egl").expect("install libegl-dev to build Orbit on Linux");
        // The client binding also loads by absolute path; don't search the current directory.
        let library = mpv.link_paths.iter().map(|p| p.join("libmpv.so.2")).find(|p| p.is_file()).expect("pkg-config mpv must point to a directory containing libmpv.so.2");
        println!("cargo:rustc-env=ORBIT_SYSTEM_LIBMPV={}", library.display());
    }
    tauri_build::build()
}
