# openDAW File System

openDAW stores your projects and samples in the
[Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (
OPFS).

## Why Samples?

openDAW uses the OPFS to store user-imported samples because modern browsers do not retain
information about the file origins of imported local files due to security restrictions. This means that once a user
imports a file, the browser has no way to automatically reload it the next time openDAW starts. To ensure persistent
access to user samples, openDAW copies every imported sample into OPFS, allowing the application to manage and retrieve
these files securely without relying on external file paths.

## Granting OPFS Storage Permission in Firefox

In Firefox, storing data in OPFS requires explicit user approval due to its privacy settings. Without permission,
openDAW may not be able to retain imported samples across sessions. To allow persistent storage for openDAW in Firefox,
follow these steps:

* Open Firefox Settings
* Navigate to Privacy & Security
* Scroll down to Permissions and find Storage Permissions
* Click Exceptions and enter the openDAW studio URL `https://opendaw.studio`
* Select Allow and confirm the changes
* Restart Firefox for the settings to take effect

## Recovery and deletion

Project discovery skips unreadable or malformed project folders with a console warning and retains them for recovery.
Root storage access errors still fail discovery. Backup uses a strict scan and stops on any unreadable project, preserving its local files. A listing is not proof that an asset is unused: sample and soundfont deletion
requires a complete scan of saved projects and presets. Repair or restore the source identified in the error before retrying deletion. Missing project metadata also blocks deletion. Preset usage scans inspect every .odp file, including files absent from the listing index.
Missing or corrupt derived sample peaks are regenerated from the audio; audio, metadata and permission failures remain errors.
Project, sample and soundfont deletion journals are deduplicated and updated under an origin-wide Web Lock per storage folder, including the file deletion.
A failed deletion retains its journal entry for retry. Web Locks support is required for these operations.


Sample saves use the same per-folder Web Lock as deletion. Required audio and peaks are written before listing metadata.
Concurrent saves of the same content UUID preserve the first complete sample instead of overwriting its binary files.
A failed new save removes only its owned incomplete directory; pre-existing incomplete samples are retained for recovery.
