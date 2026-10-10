Faster, clearer Supervisor restarts during updates.

- Native service units now stop within 15 seconds. Interactive shells from Web terminals ignore SIGTERM, so systemd used to wait 90 seconds before stopping the old Supervisor, and the device stayed offline for that whole update restart. The Supervisor refreshes its systemd unit at startup, so the shorter timeout applies from the first update after installing this version.
- While a device restarts, Settings now explains that stopping an older service can take up to two minutes when Web terminals are open, instead of implying that the update failed.
- Devices still on npm: update once to the final npm release (0.12.77), then press Update again to move to the native GitHub runtime. Verified on a WSL relay device with a systemd user service.

This release does not change the independently released Windows Device Manager.
