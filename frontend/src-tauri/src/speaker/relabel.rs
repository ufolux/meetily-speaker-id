//! Keeps the "Me" label when a meeting is re-transcribed.
//!
//! Live recordings label microphone-dominant speech as `me`, but the saved
//! recording is mixed, so re-transcription can only group voices. The previous
//! transcript's `me` time ranges tell us which new voice group is the user.

use std::collections::HashMap;

/// A new voice group becomes `me` when at least this share of its speech
/// overlaps the previous transcript's `me` ranges.
const SPEAKER_ME_OVERLAP: f64 = 0.6;
/// An unlabelled segment becomes `me` when at least this share of it overlaps.
const SEGMENT_ME_OVERLAP: f64 = 0.5;

/// Seconds of `[start, end)` covered by `ranges` (ranges may overlap each other).
fn covered(start: f64, end: f64, ranges: &[(f64, f64)]) -> f64 {
    let mut clipped: Vec<(f64, f64)> = ranges
        .iter()
        .map(|&(a, b)| (a.max(start), b.min(end)))
        .filter(|(a, b)| b > a)
        .collect();
    clipped.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mut total = 0.0;
    let mut cursor = start;
    for (a, b) in clipped {
        let a = a.max(cursor);
        if b > a {
            total += b - a;
            cursor = b;
        }
    }
    total
}

/// Relabels new segments using the previous transcript's `me` ranges.
///
/// `segments` are `(start_seconds, end_seconds, speaker)` from re-transcription;
/// `previous_me` are the `(start, end)` ranges previously labelled `me`.
/// Voice groups that mostly fall inside those ranges become `me`; unlabelled
/// segments (no voice model) inside them become `me` too. Remaining
/// `speaker_N` ids are renumbered by first appearance so there are no gaps.
pub fn carry_over_me(
    segments: &[(f64, f64, Option<String>)],
    previous_me: &[(f64, f64)],
) -> Vec<Option<String>> {
    let labels: Vec<Option<String>> = segments.iter().map(|s| s.2.clone()).collect();
    if previous_me.is_empty() {
        return labels;
    }

    // Per voice group: (total seconds, seconds overlapping previous "me").
    let mut stats: HashMap<&str, (f64, f64)> = HashMap::new();
    for (start, end, speaker) in segments {
        if let Some(id) = speaker.as_deref().filter(|id| id.starts_with("speaker_")) {
            let entry = stats.entry(id).or_insert((0.0, 0.0));
            entry.0 += (end - start).max(0.0);
            entry.1 += covered(*start, *end, previous_me);
        }
    }
    let becomes_me = |id: &str| {
        stats
            .get(id)
            .is_some_and(|(total, overlap)| *total > 0.0 && overlap / total >= SPEAKER_ME_OVERLAP)
    };

    let mut renumber: HashMap<String, String> = HashMap::new();
    segments
        .iter()
        .zip(labels)
        .map(|((start, end, _), label)| match label {
            Some(id) if becomes_me(&id) => Some("me".to_string()),
            Some(id) if id.starts_with("speaker_") => {
                let next = renumber.len() + 1;
                Some(renumber.entry(id).or_insert_with(|| format!("speaker_{next}")).clone())
            }
            Some(other) => Some(other),
            None => {
                let duration = end - start;
                (duration > 0.0 && covered(*start, *end, previous_me) / duration >= SEGMENT_ME_OVERLAP)
                    .then(|| "me".to_string())
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, end: f64, speaker: Option<&str>) -> (f64, f64, Option<String>) {
        (start, end, speaker.map(str::to_string))
    }

    fn ids(labels: &[Option<String>]) -> Vec<Option<&str>> {
        labels.iter().map(|l| l.as_deref()).collect()
    }

    #[test]
    fn no_previous_me_keeps_labels() {
        let segments = vec![seg(0.0, 2.0, Some("speaker_1")), seg(2.0, 4.0, None)];
        assert_eq!(ids(&carry_over_me(&segments, &[])), vec![Some("speaker_1"), None]);
    }

    #[test]
    fn voice_group_inside_me_ranges_becomes_me_and_others_are_renumbered() {
        // speaker_1 is someone else; speaker_2 was "me" in the live transcript.
        let segments = vec![
            seg(0.0, 4.0, Some("speaker_1")),
            seg(4.0, 9.0, Some("speaker_2")),
            seg(9.0, 12.0, Some("speaker_3")),
            seg(12.0, 15.0, Some("speaker_2")),
        ];
        let previous_me = [(3.8, 9.2), (11.5, 15.5)];
        assert_eq!(
            ids(&carry_over_me(&segments, &previous_me)),
            vec![Some("speaker_1"), Some("me"), Some("speaker_2"), Some("me")]
        );
    }

    #[test]
    fn partial_overlap_is_not_enough() {
        // Only 2 of speaker_1's 8 seconds were "me": keep it as a separate voice.
        let segments = vec![seg(0.0, 4.0, Some("speaker_1")), seg(10.0, 14.0, Some("speaker_1"))];
        assert_eq!(
            ids(&carry_over_me(&segments, &[(0.0, 2.0)])),
            vec![Some("speaker_1"), Some("speaker_1")]
        );
    }

    #[test]
    fn unlabelled_segments_inside_me_ranges_become_me() {
        // Without the voice model there are no groups; label segment by segment.
        let segments = vec![seg(0.0, 3.0, None), seg(3.0, 6.0, None)];
        assert_eq!(ids(&carry_over_me(&segments, &[(0.0, 2.5)])), vec![Some("me"), None]);
    }

    #[test]
    fn overlapping_previous_ranges_are_not_double_counted() {
        assert!((covered(0.0, 10.0, &[(1.0, 5.0), (2.0, 4.0), (4.0, 6.0)]) - 5.0).abs() < 1e-9);
    }
}
