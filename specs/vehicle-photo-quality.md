# Vehicle Photo Quality Scoring

Automated system to score and flag low-quality vehicle listing photos using computer vision, improving marketplace trust and booking conversion. This is a sample test feature.

## Photo Upload Validation

When a host uploads photos during listing creation or editing, validate each image in real-time before it's accepted.

- [ ] Reject images below 800x600 resolution
- [ ] Detect and flag blurry images (Laplacian variance threshold)
- [ ] Reject screenshots and stock photos via classifier
- [ ] Show inline error messaging with specific rejection reason
- [ ] Allow hosts to retry upload immediately after rejection

## Automated Quality Scoring Pipeline

Score each accepted photo on a 1-5 scale across multiple dimensions, run async after upload.

- [ ] Build scoring prompt for Claude vision API (lighting, framing, background, vehicle visibility)
- [ ] Store per-photo scores in photo_quality_scores table
- [ ] Compute aggregate listing quality score (weighted average across photos)
- [ ] Define confidence threshold — flag for human review if model confidence < 0.7
- [ ] Add retry logic with exponential backoff for API failures

## Host Dashboard — Quality Feedback

Surface photo quality scores to hosts with actionable guidance on how to improve.

- [ ] Add "Photo Quality" section to listing management page
- [ ] Show per-photo score with color-coded indicator (red/yellow/green)
- [ ] Display specific improvement tips per low-scoring dimension (e.g., "Try natural lighting")
- [ ] Add "Retake" CTA that deep-links to camera with framing guide overlay
- [ ] Track improvement rate — hosts who re-upload after seeing feedback

## Guest-Facing Quality Signals

Use photo quality scores to influence search ranking and display trust signals to guests.

- [ ] Add quality score as a ranking factor in search (weight TBD — start at 5%)
- [ ] Display "Verified Photos" badge on listings scoring 4.0+ average
- [ ] A/B test badge impact on click-through and booking conversion
- [ ] Exclude listings with average score below 2.0 from featured placements
