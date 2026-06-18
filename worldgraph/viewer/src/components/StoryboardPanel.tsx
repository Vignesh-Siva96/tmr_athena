"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { World } from "@/types";
import { useGraphStore } from "@/store/useGraphStore";

const BEAT_DURATION_MS = 2600;

export default function StoryboardPanel({ world }: { world: World }) {
  const activeJourney = useGraphStore((s) => s.activeJourney);
  const setJourney = useGraphStore((s) => s.setJourney);
  const beatIndex = useGraphStore((s) => s.beatIndex);
  const playing = useGraphStore((s) => s.playing);
  const play = useGraphStore((s) => s.play);
  const pause = useGraphStore((s) => s.pause);
  const step = useGraphStore((s) => s.step);
  const select = useGraphStore((s) => s.select);

  const journey = activeJourney ? world.journeys[activeJourney] : null;
  const beats = journey?.beats ?? [];

  useEffect(() => {
    if (!playing || !journey) return;
    const timer = setInterval(() => step(1, beats.length), BEAT_DURATION_MS);
    return () => clearInterval(timer);
  }, [playing, journey, beats.length, step]);

  useEffect(() => {
    if (playing && beatIndex >= beats.length - 1) pause();
  }, [beatIndex, beats.length, playing, pause]);

  useEffect(() => {
    if (journey && beats[beatIndex]) select(beats[beatIndex].node);
  }, [journey, beats, beatIndex, select]);

  return (
    <div className="storyboard-bar">
      <div className="storyboard-controls">
        <select
          value={activeJourney ?? ""}
          onChange={(e) => setJourney(e.target.value || null)}
        >
          <option value="">— pick a journey —</option>
          {Object.entries(world.journeys).map(([label, j]) => (
            <option key={label} value={label}>
              {j.title}
            </option>
          ))}
        </select>
        <button onClick={() => step(-1, beats.length)} disabled={!journey || beatIndex === 0}>
          ◀ Prev
        </button>
        {playing ? (
          <button onClick={pause} disabled={!journey}>
            ⏸ Pause
          </button>
        ) : (
          <button onClick={play} disabled={!journey || beatIndex >= beats.length - 1}>
            ▶ Play
          </button>
        )}
        <button onClick={() => step(1, beats.length)} disabled={!journey || beatIndex >= beats.length - 1}>
          Next ▶
        </button>
      </div>
      <div className="storyboard-caption">
        <AnimatePresence mode="wait">
          {journey && beats[beatIndex] && (
            <motion.div
              key={beatIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              <span className="beat-index">
                {beatIndex + 1}/{beats.length} · {beats[beatIndex].node}
              </span>
              {beats[beatIndex].say}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
