// The shell carries no product logic — MEW is the SPA in app/; this window
// just hosts it with an app-scoped storage profile.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mew_desktop_lib::run()
}
