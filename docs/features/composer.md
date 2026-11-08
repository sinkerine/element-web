# Composer Features

## Auto Complete

- Hitting tab tries to auto-complete the word before the caret as a room member
    - If no matching name is found, a visual bell is shown
- @ + a letter opens auto complete for members starting with the given letter
    - When inserting a user pill at the start in the composer, a colon and space is appended to the pill
    - When inserting a user pill anywhere else in composer, only a space is appended to the pill
- # + a letter opens auto complete for rooms starting with the given letter
- : open auto complete for emoji
- Pressing arrow-up/arrow-down while the autocomplete is open navigates between auto complete options
- Pressing tab while the autocomplete is open goes to the next autocomplete option,
  wrapping around at the end after reverting to the typed text first.

## Formatting

- When selecting text, a formatting bar appears above the selection.
- The formatting bar allows to format the selected test as:
  bold, italic, strikethrough, a block quote, and a code block (inline if no linebreak is selected).
- Formatting is applied as markdown syntax.
- Hitting ctrl/cmd+B also marks the selected text as bold
- Hitting ctrl/cmd+I also marks the selected text as italic
- Hitting ctrl/cmd+> also marks the selected text as a blockquote

## Attachments and captions

Use the attachment button, paste an image, or drag files into the room to open the upload dialog. The dialog shows a
preview and a **Caption** field. Text already in the composer is copied into the caption, including Markdown formatting
and member mentions. The caption receives focus with the caret at the end, so you can keep typing immediately.

Press Enter or choose **Upload** to send the file and its caption as one message. Shift+Enter adds a line break to the
caption. A nonempty caption clears the original composer draft after sending. Clearing the caption sends the file on
its own and keeps the draft in the composer; closing the dialog also keeps the draft and sends nothing.

When selecting several files, the shared caption is sent with the last file. Choose **Upload all** to send all selected
files in order. Earlier files are sent without a caption.

Use **Edit** on an attachment message to add, change, or remove its caption. Formatting and member mentions are
supported just as they are in the message composer. Saving an empty caption keeps the attachment, and the message
continues to show its edited marker.

Captioned attachments also work in replies, threads, and encrypted rooms. A reply keeps the quoted message above the
attachment; a thread attachment stays in its thread. In an encrypted room, both the caption and attachment are encrypted.

## Misc

- When hitting the arrow-up button while having the caret at the start in the composer,
  the last message sent by the syncing user is edited.
- Clicking a display name on an event in the timeline inserts a user pill into the composer
- Emoticons (like :-), >:-), :-/, ...) are replaced by emojis while typing if the relevant setting is enabled
- Typing in the composer sends typing notifications in the room
- Pressing ctrl/mod+z and ctrl/mod+y undoes/redoes modifications
- Pressing shift+enter inserts a line break
- Pressing enter sends the message.
- Choosing "Quote" in the context menu of an event inserts a quote of the event body in the composer.
- Choosing "Reply" in the context menu of an event shows a preview above the composer to reply to.
- Pressing alt+arrow up/arrow down navigates in previously sent messages, putting them in the composer.
