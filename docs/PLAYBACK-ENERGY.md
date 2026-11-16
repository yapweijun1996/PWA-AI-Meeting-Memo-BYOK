# Recording-energy halos

The group-chat Playback view samples the local recording through a Web Audio `AnalyserNode`. The recording's RMS is smoothed as `previous * 0.75 + current * 0.25`, clamped to 0–1, and mapped to a decorative halo scale of 1–1.12. Exact digital silence resets the energy to zero. It measures the combined recording: overlapping source-attributed labels share the same sample. It does not isolate a person's volume, establish acoustic identity, repair diarization or change evidence.

`HTMLMediaElement.currentTime` remains the sole timeline. Energy has its own external store; a subscription updates one inherited CSS property instead of rendering the meeting tree on each audio sample. Only labels attributed at the current source interval while status is playing use that scale. Pause, waiting, ended, media errors, hidden documents and reduced motion clear the energy; gaps and inactive labels retain scale 1. No microphone or provider request is involved.

## Audio-path ownership

One lazily created context is retained for the page lifetime. Each native media element has at most one source node, cached by weak identity. The source connects directly to the destination and separately to the analyser; the analyser's output is unconnected. No filter or gain is added to the application's audible path. The 512-sample array is reused. The chunked player exposes its current native element read-only; changing elements releases the old graph owner and starts smoothing afresh.

No new element is rerouted until the context is actually running. An unavailable context, refused resume or unsupported source produces zero energy. Previously bound output paths are reconnected on effect replay even when reduced motion is active, and resume is still allowed for those paths: disabling an animation must not disconnect recording playback. Releasing the final owner disconnects that source; another owner remains connected. The context is not closed by a view change or React effect replay, since a closed media-element source cannot simply be replaced. Physical-device power consumption, interruption and suspension remain unmeasured.

See the primary API contracts for [media-element source routing](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource) and [analyser nodes with an unconnected output](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).

## Reproduce and limits

```bash
npx vitest run tests/playback-energy.test.ts
npm run build
npx playwright test tests/browser/playback-energy.spec.ts --workers=1
npm run --silent probe:playback-audio
```

The unit cases exercise smoothing, bounded publication, source reuse, effect replay, ownership, element switches, silence and denied/unavailable contexts. The browser cases distinguish synthetic state drivers from native processing: controlled samples verify overlap, pause, gaps, silence, buffering, unavailable Web Audio and live reduced-motion changes; a generated native WAV verifies nonzero recording energy reaches the rendered halo while its real clock continues. Its final output is muted by a test-only gain. This proves neither audible speaker output nor physical-phone behavior. Long-player regression and unit element switches do not certify nonzero energy from every container/device/chunk boundary.

`probe:playback-audio` is independent of the application: each engine runs an oscillator control and a generated three-second mono PCM WAV through an analyser and a zero-gain final output. It opens no microphone, loads no user path, contacts no provider and blocks/asserts requests beyond its intercepted local HTML page and generated same-origin Blob. It checks finite nonzero samples and clock advancement; it exits nonzero if these bounded checks fail. The [recorded control results](benchmarks/playback-energy-capability-2026-11-16.json) identify both browser versions. This diagnostic cannot establish the cause of historical native-clock failures, recording-format support in general, real-duration limits, physical output or voice quality. Integrated release evidence is maintained in [validation](VALIDATION.md).
