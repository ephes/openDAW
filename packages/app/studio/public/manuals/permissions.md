# Browser Permissions

## TLDR

Browsers only reveal the full list of audio devices once microphone access has been granted. That’s why openDAW needs to
request microphone permission before you can select inputs. We recommend allowing this access permanently when prompted,
as it makes working with openDAW much smoother.

## More Info

In all modern browsers, `navigator.mediaDevices.enumerateDevices()` will only list audio and video devices after the
user
grants permission—typically via a getUserMedia() call. Chrome, Safari, and Firefox have all adopted this behavior to
protect user privacy and reduce fingerprinting risks. Without permission, device names, IDs, or availability remain
hidden. This is how browsers are designed. Granting microphone access ensures openDAW can list
all connected audio devices properly.

[Lookup 'enumerateDevices'](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
## Unsupported permission queries and selected inputs

If the browser cannot query microphone permission, openDAW asks through the
browser's capture request instead. A reported denial remains visible; capture
refusal can be retried. The temporary stream used to reveal device labels stops
all its tracks immediately.

Selecting a specific microphone requires that exact device. If it disappears,
recording setup fails so you can reselect deliberately; it never silently records
another microphone. Omitting the input selector keeps the browser default.
