# Android Bugfix Requirements

1. Relay connection setup
   - Remove the duplicated sign-in control on the relay account page.
   - Validate the relay URL before entering the relay login page.
   - Keep Register on the same action row as Back and Sign in, aligned right with smaller underlined text.

2. Relay device management
   - Name the relay device page "Device management".
   - Refresh device status automatically every 5 seconds.
   - Copying the token must copy the full `remote-codex supervisor setup` command.
   - Remove the non-clickable "Setup" tag.

3. Connection/account menu
   - Replace the "Connection" button with a head/avatar icon using the first two characters of the username, matching the web UI.
   - Open a floating account/connection window when tapped.
   - Close the floating window when tapping outside it, and include a top-right close button instead of a Back button.
   - Use a better title than "Connection".
   - Remove the top-left "R" icon.

4. Threads page
   - Remove the Files display from thread rows.

5. Thread workspace
   - Remove Tool Usage, Guide, Graph, and Extensions.
   - Rename the secondary workspace tab to "Explorer".
   - Add "Viewer" in the bottom half, matching the web UI.
   - Make Explorer interactive.
   - Keep download controls visible for folders, and update the backend so folder downloads recursively check size and file count.
   - Folder downloads must be allowed only under 100 MB and under 300 files, zip the folder, return it to the user, and clean up the temporary zip after download.
   - Fix folder downloads for the web UI too.

Verification requirement: run end-to-end testing to confirm the modifications work.
