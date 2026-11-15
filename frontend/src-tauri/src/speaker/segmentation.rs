//! Speaker-change segmentation for batch audio (import / re-transcription).
//!
//! Batch VAD segments can run for many seconds and span several speakers, so a
//! label per segment is not enough. Each segment is covered with short
//! overlapping windows, every window is embedded, all windows of the recording
//! are clustered together, and segments are cut where the window label changes.
//! Each resulting span is transcribed separately and keeps its speaker id.

use super::clustering::cluster_offline_with_threshold;

const SAMPLE_RATE: usize = 16_000;
// Calibrated on a real 20-minute, two-person meeting (see the `calibration`
// test below). 1.5 s windows were too noisy at any threshold (31 clusters at
// the original 0.55). With 3 s windows and average-linkage clustering,
// thresholds 0.15-0.20 recovered exactly two speakers; 0.25 added a stray
// third cluster. Note the threshold is a mean pairwise cosine between windows,
// which is much lower than a single-pair similarity on noisy real speech.
/// Window length for change detection; long enough for a reliable voiceprint.
pub const WINDOW_SECONDS: f32 = 3.0;
/// Hop between windows; sets the resolution of speaker-change cut points (±0.75 s).
pub const STEP_SECONDS: f32 = 1.5;
/// Spans shorter than this are folded into a neighbour (too short to transcribe well).
pub const MIN_SPAN_SECONDS: f32 = 1.0;
/// Average-linkage cosine threshold for clustering windows. Paired with
/// fragment folding in `cluster_embeddings`, which absorbs the stray side
/// cluster 0.25 left on the real recording while keeping distinct voices apart.
pub const WINDOW_CLUSTER_THRESHOLD: f32 = 0.25;

#[derive(Debug, Clone, PartialEq)]
pub struct LabeledSpan {
    /// Sample offsets within the segment, `[start, end)`.
    pub start: usize,
    pub end: usize,
    pub speaker: Option<String>,
}

/// Window `[start, end)` offsets covering `len` samples. The last window is
/// aligned to the end so the tail is covered.
fn windows(len: usize) -> Vec<(usize, usize)> {
    let win = (WINDOW_SECONDS * SAMPLE_RATE as f32) as usize;
    let step = (STEP_SECONDS * SAMPLE_RATE as f32) as usize;
    if len <= win {
        return vec![(0, len)];
    }
    let mut out = Vec::new();
    let mut start = 0;
    while start + win < len {
        out.push((start, start + win));
        start += step;
    }
    out.push((len - win, len));
    out
}

/// Splits each segment into speaker-homogeneous spans.
/// `embed` returns a voiceprint for a window (or `None` if it cannot).
pub fn segment_by_speaker<F>(segments: &[&[f32]], mut embed: F) -> Vec<Vec<LabeledSpan>>
where
    F: FnMut(&[f32]) -> Option<Vec<f32>>,
{
    // Embed every window of every segment.
    let mut window_ranges: Vec<Vec<(usize, usize)>> = Vec::with_capacity(segments.len());
    let mut embeddings: Vec<Option<Vec<f32>>> = Vec::new();
    for segment in segments {
        let ranges = windows(segment.len());
        for &(a, b) in &ranges {
            embeddings.push(embed(&segment[a..b]));
        }
        window_ranges.push(ranges);
    }

    // Cluster all windows of the recording together so ids are global.
    let labels = cluster_offline_with_threshold(&embeddings, WINDOW_CLUSTER_THRESHOLD);

    let min_span = (MIN_SPAN_SECONDS * SAMPLE_RATE as f32) as usize;
    let mut offset = 0;
    let mut result = Vec::with_capacity(segments.len());
    for (segment, ranges) in segments.iter().zip(&window_ranges) {
        let mut window_labels: Vec<Option<String>> = labels[offset..offset + ranges.len()].to_vec();
        offset += ranges.len();

        // Smooth single-window blips (A B A -> A A A).
        for i in 1..window_labels.len().saturating_sub(1) {
            if window_labels[i - 1] == window_labels[i + 1] && window_labels[i] != window_labels[i - 1] {
                window_labels[i] = window_labels[i - 1].clone();
            }
        }

        // Runs of equal labels become spans; cut between the centres of the
        // last window of one run and the first window of the next.
        let mut spans: Vec<LabeledSpan> = Vec::new();
        let mut run_start_sample = 0;
        for i in 0..window_labels.len() {
            let is_last = i + 1 == window_labels.len();
            if is_last || window_labels[i + 1] != window_labels[i] {
                let end = if is_last {
                    segment.len()
                } else {
                    let centre = |(a, b): (usize, usize)| (a + b) / 2;
                    (centre(ranges[i]) + centre(ranges[i + 1])) / 2
                };
                spans.push(LabeledSpan { start: run_start_sample, end, speaker: window_labels[i].clone() });
                run_start_sample = end;
            }
        }

        // Fold spans that are too short to transcribe into a neighbour,
        // and join neighbours that end up with the same speaker.
        let mut merged: Vec<LabeledSpan> = Vec::new();
        for span in spans {
            match merged.last_mut() {
                Some(prev) if prev.speaker == span.speaker || span.end - span.start < min_span => {
                    prev.end = span.end;
                }
                _ => merged.push(span),
            }
        }
        if merged.len() > 1 && merged[0].end - merged[0].start < min_span {
            let first = merged.remove(0);
            merged[0].start = first.start;
        }
        result.push(merged);
    }
    renumber_by_first_appearance(&mut result);
    result
}

/// Clusters that only existed in smoothed-away windows (e.g. silence) leave gaps
/// in the numbering; relabel so speakers read Speaker 1, 2, 3... in order.
fn renumber_by_first_appearance(spans: &mut [Vec<LabeledSpan>]) {
    let mut mapping: std::collections::HashMap<String, String> = Default::default();
    for span in spans.iter_mut().flatten() {
        if let Some(old) = span.speaker.take() {
            let next = super::clustering::speaker_number_id(mapping.len() + 1);
            span.speaker = Some(mapping.entry(old).or_insert(next).clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake "audio" where the sample value encodes the speaker (1.0 or 2.0).
    fn fake_embed(window: &[f32]) -> Option<Vec<f32>> {
        let mean = window.iter().sum::<f32>() / window.len() as f32;
        let mut v = vec![0.0f32; 4];
        if mean < 1.5 {
            v[0] = 1.0;
        } else {
            v[2] = 1.0;
        }
        Some(v)
    }

    fn secs(s: f32) -> usize {
        (s * SAMPLE_RATE as f32) as usize
    }

    #[test]
    fn windows_cover_the_whole_segment() {
        assert_eq!(windows(secs(1.0)), vec![(0, secs(1.0))]);
        let w = windows(secs(3.2));
        assert_eq!(w.first().unwrap().0, 0);
        assert_eq!(w.last().unwrap().1, secs(3.2));
    }

    #[test]
    fn cuts_a_two_speaker_segment_near_the_change() {
        let mut segment = vec![1.0f32; secs(6.0)];
        segment.extend(vec![2.0f32; secs(5.0)]);
        let spans = segment_by_speaker(&[&segment], fake_embed);
        assert_eq!(spans[0].len(), 2, "{:?}", spans[0]);
        let cut = spans[0][0].end as f32 / SAMPLE_RATE as f32;
        assert!((cut - 6.0).abs() <= 0.75, "cut at {cut}s");
        assert_eq!(spans[0][0].speaker.as_deref(), Some("speaker_1"));
        assert_eq!(spans[0][1].speaker.as_deref(), Some("speaker_2"));
        assert_eq!(spans[0][1].end, segment.len());
    }

    #[test]
    fn ids_are_consistent_across_segments_and_short_blips_fold() {
        let a = vec![1.0f32; secs(3.0)];
        let mut b = vec![2.0f32; secs(4.0)];
        b.extend(vec![1.0f32; secs(0.4)]); // too short to stand alone
        let spans = segment_by_speaker(&[&a, &b], fake_embed);
        assert_eq!(spans[0], vec![LabeledSpan { start: 0, end: a.len(), speaker: Some("speaker_1".into()) }]);
        assert_eq!(spans[1].len(), 1);
        assert_eq!(spans[1][0].speaker.as_deref(), Some("speaker_2"));
        assert_eq!(spans[1][0].end, b.len());
    }
}

/// Local calibration on a real recording (never runs in CI; prints numbers only).
/// SPEAKER_MODEL_PATH=... SPEAKER_REAL_AUDIO=/path/file SPEAKER_REAL_COUNT=2 \
///   cargo test --release --lib speaker::segmentation::calibration -- --ignored --nocapture
#[cfg(test)]
mod calibration {
    use super::*;
    use crate::speaker::embedding::{cosine, SpeakerEmbeddingModel};

    fn summarize(labels: &[Option<String>]) -> (usize, Vec<usize>) {
        let mut counts: std::collections::HashMap<&str, usize> = Default::default();
        for l in labels.iter().flatten() {
            *counts.entry(l.as_str()).or_default() += 1;
        }
        let mut sizes: Vec<usize> = counts.values().copied().collect();
        sizes.sort_unstable_by(|a, b| b.cmp(a));
        (sizes.len(), sizes)
    }

    #[test]
    #[ignore]
    fn calibrate_on_real_recording() {
        let model_path = std::env::var("SPEAKER_MODEL_PATH").expect("SPEAKER_MODEL_PATH");
        let audio_path = std::env::var("SPEAKER_REAL_AUDIO").expect("SPEAKER_REAL_AUDIO");
        let mut model = SpeakerEmbeddingModel::load(std::path::Path::new(&model_path)).unwrap();
        let decoded = crate::audio::decoder::decode_audio_file(std::path::Path::new(&audio_path)).unwrap();
        let audio = decoded.to_whisper_format();
        let segments = crate::audio::vad::get_speech_chunks(&audio, 2000).unwrap();
        let speech: f32 = segments.iter().map(|s| s.samples.len() as f32 / 16_000.0).sum();
        println!("audio {:.1} min, {} VAD segments, {:.1} min speech", audio.len() as f32 / 960_000.0, segments.len(), speech / 60.0);

        for (win, step) in [(2.0f32, 1.0f32), (3.0, 1.5)] {
            let w = (win * 16_000.0) as usize;
            let st = (step * 16_000.0) as usize;
            let mut embs: Vec<Option<Vec<f32>>> = Vec::new();
            for s in &segments {
                let n = s.samples.len();
                let mut a = 0;
                if n <= w {
                    embs.push(model.embed(&s.samples).ok().flatten());
                    continue;
                }
                while a + w <= n {
                    embs.push(model.embed(&s.samples[a..a + w]).ok().flatten());
                    a += st;
                }
            }
            let vecs: Vec<&Vec<f32>> = embs.iter().flatten().collect();
            // Similarity of each window to its temporal neighbour (mostly same speaker)
            // vs. to a random far window (often the other speaker).
            let mut adj: Vec<f32> = vecs.windows(2).map(|p| cosine(p[0], p[1])).collect();
            let mut far: Vec<f32> = (0..vecs.len()).map(|i| cosine(vecs[i], vecs[(i * 7919 + vecs.len() / 2) % vecs.len()])).collect();
            adj.sort_by(|a, b| a.total_cmp(b));
            far.sort_by(|a, b| a.total_cmp(b));
            let q = |v: &Vec<f32>, p: f32| v[((v.len() - 1) as f32 * p) as usize];
            println!(
                "\nwindow {win}s/{step}s: {} windows | neighbour sim p10/p50/p90 {:.2}/{:.2}/{:.2} | far sim p10/p50/p90 {:.2}/{:.2}/{:.2}",
                vecs.len(), q(&adj, 0.1), q(&adj, 0.5), q(&adj, 0.9), q(&far, 0.1), q(&far, 0.5), q(&far, 0.9)
            );
            for t in [0.15f32, 0.2, 0.25, 0.3, 0.35, 0.4] {
                let labels = crate::speaker::clustering::cluster_offline_with_threshold(&embs, t);
                let (k, sizes) = summarize(&labels);
                let top2: usize = sizes.iter().take(2).sum();
                println!(
                    "  threshold {t:.2}: {k:3} clusters, top-2 cover {:5.1}% | sizes {:?}",
                    100.0 * top2 as f32 / vecs.len() as f32,
                    &sizes[..sizes.len().min(8)]
                );
            }
        }

        // Between- vs within-speaker mean similarity for the production setting.
        {
            let w = (WINDOW_SECONDS * 16_000.0) as usize;
            let st = (STEP_SECONDS * 16_000.0) as usize;
            let mut embs: Vec<Vec<f32>> = Vec::new();
            for s in &segments {
                let n = s.samples.len();
                let mut a = 0;
                while a + w <= n {
                    if let Ok(Some(e)) = model.embed(&s.samples[a..a + w]) { embs.push(e); }
                    a += st;
                }
            }
            let opt: Vec<Option<Vec<f32>>> = embs.iter().cloned().map(Some).collect();
            let labels = crate::speaker::clustering::cluster_offline_with_threshold(&opt, WINDOW_CLUSTER_THRESHOLD);
            let ids: Vec<String> = { let mut v: Vec<String> = labels.iter().flatten().cloned().collect(); v.sort(); v.dedup(); v };
            println!("\nproduction setting ({}s/{}s, {:.2}): {} speakers", WINDOW_SECONDS, STEP_SECONDS, WINDOW_CLUSTER_THRESHOLD, ids.len());
            for a in &ids {
                for b in &ids {
                    if a > b { continue; }
                    let (mut sum, mut n) = (0.0f32, 0usize);
                    for i in 0..embs.len() { for j in 0..embs.len() {
                        if i != j && labels[i].as_deref() == Some(a.as_str()) && labels[j].as_deref() == Some(b.as_str()) { sum += cosine(&embs[i], &embs[j]); n += 1; }
                    }}
                    println!("  mean sim {a} x {b}: {:.3} ({} pairs)", sum / n.max(1) as f32, n);
                }
            }
        }

        // Live path: VAD segments with the live 500 ms redemption, labelled one at a
        // time by the online clusterer (no source info in a mixed file).
        let live = crate::audio::vad::get_speech_chunks(&audio, 500).unwrap();
        let live_embs: Vec<(Option<Vec<f32>>, f32)> = live
            .iter()
            .map(|s| (model.embed(&s.samples).ok().flatten(), s.samples.len() as f32 / 16_000.0))
            .collect();
        println!("\nlive: {} VAD segments", live.len());
        for (m, w) in [(0.62f32, 0.4f32), (0.5, 0.3), (0.45, 0.3), (0.4, 0.25), (0.35, 0.2), (0.3, 0.2)] {
            let mut c = crate::speaker::OnlineSpeakerClusterer::with_thresholds(false, m, w);
            let labels: Vec<Option<String>> = live_embs.iter().map(|(e, d)| c.assign(e.as_deref(), crate::speaker::SpeakerSource::Microphone, *d)).collect();
            let (k, sizes) = summarize(&labels);
            let top2: usize = sizes.iter().take(2).sum();
            println!("  match {m:.2}/weak {w:.2}: {k:2} speakers, top-2 cover {:5.1}% | sizes {:?}", 100.0 * top2 as f32 / labels.len() as f32, &sizes[..sizes.len().min(8)]);
        }
    }
}
