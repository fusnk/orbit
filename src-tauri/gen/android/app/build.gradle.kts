import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "io.github.fusnk.orbit"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "io.github.fusnk.orbit"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// The Android half of rustls-platform-verifier (Orbit's HTTPS certificate checks, see
// src-tauri/src/android/tls.rs) is a small .aar that ships inside the Rust crate; cargo says where,
// and which version, so it always matches Cargo.lock.
val rustlsPlatformVerifier: Map<String, Any> = run {
    val metadata = providers.exec {
        workingDir = rootDir.resolve("../..")
        commandLine("cargo", "metadata", "--format-version", "1", "--filter-platform", "aarch64-linux-android", "--manifest-path", "Cargo.toml")
    }.standardOutput.asText.get()
    @Suppress("UNCHECKED_CAST")
    val packages = (groovy.json.JsonSlurper().parseText(metadata) as Map<String, Any>)["packages"] as List<Map<String, Any>>
    packages.first { it["name"] == "rustls-platform-verifier-android" }
}

repositories {
    maven {
        url = uri(File(File(rustlsPlatformVerifier["manifest_path"] as String).parentFile, "maven"))
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("rustls:rustls-platform-verifier:${rustlsPlatformVerifier["version"]}")
    // Video on Android (NativePlayer.kt): Google's Media3 player, Apache-2.0. HLS for live TV and the
    // addons that stream it; the rest (MP4, MKV, WebM, TS) is built in.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")
    // The player as the rest of Android sees it: "Hey Google, pause", a TV's own remote over HDMI-CEC,
    // the system's Now Playing (NativePlayer.kt). Apache-2.0, part of Media3.
    implementation("androidx.media3:media3-session:1.8.0")
    // Audio Android can't decode on many boxes (DTS, TrueHD, AC-3/E-AC-3 without a receiver): Media3's
    // FFmpeg decoder as Jellyfin builds and publishes it, GPL-3.0 (as Orbit), version matched to Media3.
    // Used only when no platform decoder or passthrough takes the track.
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:1.8.0+1")
    // Orbit's Continue Watching on the Android TV / Google TV home screen (WatchNext.kt). Apache-2.0.
    implementation("androidx.tvprovider:tvprovider:1.1.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
