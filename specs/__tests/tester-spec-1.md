# Avatar Upload

Let signed-in users upload, replace, or remove a profile photo.

## Overview

Today users can only set an avatar at signup. They cannot change or remove it afterward, which generates a steady stream of support requests. This adds full CRUD on the avatar from the account settings page.

## Upload Flow

Users tap or click the avatar on the account settings page to open a file picker. Accepted formats: PNG, JPEG, WEBP. Maximum file size: 5 MB. The image is cropped client-side to a 512×512 square before upload, then sent to S3 via a signed URL. The user record is updated with the new avatar URL on successful upload.

- [ ] Open file picker on avatar tap
- [ ] Client-side crop tool with square aspect ratio
- [ ] Upload to S3 with signed URL
- [ ] Update user record with new avatar URL
- [ ] Reject files over 5 MB with inline error

## Replace and Remove

A signed-in user with an existing avatar can replace it with a new one or remove it entirely. Removal restores the default placeholder avatar, which is derived from the user's initials on the server.

- [ ] Replace flow reuses Upload Flow
- [ ] Remove button next to avatar with confirmation dialog
- [ ] Default placeholder is initials-based, generated server-side

## Open Questions

- Should we strip EXIF metadata from uploaded images for privacy?
- What rate limit should we apply per user per hour on uploads?
- Do we need a soft-delete window so users can recover a removed avatar?
