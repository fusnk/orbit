//! Android's certificate checks for Orbit's own HTTPS requests (reqwest with
//! rustls' platform verifier, which asks Android's trust store). The verifier
//! reaches Android through the app's context, handed over once by
//! `TlsInit.init` in gen/android before anything can make a request; without
//! it every HTTPS request would fail.

use jni::EnvUnowned;
use jni::errors::ThrowRuntimeExAndDefault;
use jni::objects::{JClass, JObject};

/// `io.github.fusnk.orbit.TlsInit.init(Context)`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_fusnk_orbit_TlsInit_init<'local>(mut env: EnvUnowned<'local>, _class: JClass<'local>, context: JObject<'local>) {
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context)).resolve::<ThrowRuntimeExAndDefault>()
}
