uBobs Auto Next v1.1

HOW TO RUN
1. Extract this ZIP to a normal folder, for example C:\catholic_macro\ubob-auto-next.
2. Double-click start.bat.
3. On the first run, npm installs playwright-core automatically.
4. A dedicated Chrome window opens. Log in once if needed.
5. Keep that Chrome window open while studying.
6. When the specific content-complete popup appears, its Confirm button is clicked automatically.
7. The automation continues after the site advances to the next video.

STOP
- Close the automation Chrome window, or press Ctrl+C in the console window.

FILES CREATED AUTOMATICALLY
- chrome-profile\ : dedicated Chrome login/profile data
- logs\           : date-based logs
- state.json      : click count and last SeriesDetail URL

IMPORTANT
- start.bat is intentionally ASCII-only and uses Windows CRLF line endings for cmd.exe compatibility.
- The script only clicks the matching content-complete popup, not arbitrary Confirm buttons.
