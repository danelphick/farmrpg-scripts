# Action Announcements

Action Announcements is a Tampermonkey/Greasemonkey script for FarmRPG that displays in-game
announcements for various actions, such as when your crops are ready for harvest and your kitchen
has available cooking actions.

## Features

- **Crop Ready Announcements:** Get notified when your crops are ready to be harvested.
- **Cooking Announcements:** Get notified when your meals can be collected, stirred, tasted or
  seasoned.
- **Customizable announcements:** All actions can be set to announce with speech, OS notification,
  both or none.
- **Timers display:** In the bottom left corner, timers for each available action are shown.

## Installation

To use Action Announcements, you'll need to have Tampermonkey installed in your web browser.

### 1. Install Tampermonkey

If you don't already have Tampermonkey, you can install it from your browser's extension store:

- [**Chrome**](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en)
- [**Firefox**](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

I think this will also work with Greasemonkey but I haven't tested it. Happy to make changes, if you find issues with Greasemonkey and this script.

### 2. Install Action Announcements

1.  Click on this link to open the script in Tampermonkey:
2.  [Action Announcements.user.js](https://github.com/danelphick/farmrpg/raw/main/Action%20Announcements.user.js).
3.  Tampermonkey will open a new tab showing the script's source code.
4.  Click the "Install" button.

### 3. Verify Installation

1.  Go to [FarmRPG](https://farmrpg.com/).
2.  You should now see timers in the bottom left corner and see announcements when tracked actions
    are ready.

## Usage

Once installed, Action Announcements will automatically start working when you play FarmRPG.

You can customise the notifications by clicking on the *Open Settings* button under the timers.
There are also test buttons that show you what each kind of announcement will be like.

Clicking on the OS notifications will take you back to your FarmRPG tab and will navigate to the
kitchen for the cooking actions. For crop notifications, if not already on the farm page, it will
navigate to the main page from which you can navigate to the farm. It doesn't navigate to the farm
directly as there isn't a button in the sidebar for that.

## Limitations/Bugs

### Timer Display

This only appears when the window is wide enough for the 3-column mode where chat and the menu are
always displayed.

### Synchronization

The script works by reading the pages that you look at, so it cannot see actions performed outside
of FarmRPG in your browser. If you also play on mobile or another browser, it will get out of sync
and you will have to go back to the farm/kitchen/oven pages for the timers to be picked up again.

### OS Notifications

Sometimes these don't appear. I don't know why.

Tampermonkey's notifications don't seem to have an API to close a notification directly without
using a timeout. I found I can trigger a notification to close by setting a short timeout while
matching the tag of the previous notification. On Mac at least this doesn't work properly when the
notification appears over a full-screen video.

### Speech Notifications

These also stop working sometimes. Sometimes it's just an intermittent thing and they work the next
time. However sometimes they stop working altogether and it appears to be because the speech
synthesis API in chrome gets stuck and it thinks it's still speaking. This can be solved with
window.speechSynthesis.cancel(), but at this point I don't want to force it do that every time it
speaks in case multiple announcements happen at the same time.

If it seems to get into this state, go to settings and click *Test Speech Notifications*, which
should get it working again.

### Double announcements

Sometimes it re-announces cooking done or crops done, just as you complete the action. It's probably
reading stale state and needs to be made a bit more resilient to that.

### Intended Behaviour

This is just for showing timers and reminding you to take actions. It will not play the game for you
and so will never complete the actual actions for you. **That's your job!**
