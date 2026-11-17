_This package is part of the openDAW SDK_

# @opendaw/lib-dawproject

Application agnostic XML Schema for [DAWproject](https://github.com/bitwig/dawproject) files.

Audio elements retain their optional display `name` independently of the archive
File path, so identity-based media paths do not replace human sample labels.

Every automation Point subtype requires a finite numeric `time`; missing, blank
or malformed values are refused while parsing, and zero remains a numeric zero.
Studio additionally admits only times representable by its native pulse fields.
