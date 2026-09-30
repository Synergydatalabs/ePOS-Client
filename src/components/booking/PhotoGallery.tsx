"use client";

// Simple photo gallery for the booking detail page.
// Hero image up top, scrollable thumbnail strip below.
// Tap a thumb → swap hero. Tap hero → open lightbox.

import { useState } from "react";
import { Icon } from "@iconify/react";

interface Photo {
  id: string;
  url: string;
  thumbnailUrl?: string | null;
  caption?: string | null;
  altText?: string | null;
}

export default function PhotoGallery({ photos }: { photos: Photo[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (photos.length === 0) return null;
  const active = photos[activeIndex];

  return (
    <>
      <div className="space-y-3">
        {/* Hero */}
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block w-full aspect-[16/10] rounded-2xl overflow-hidden bg-gray-100 group relative"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.url}
            alt={active.altText || active.caption || "Restaurant photo"}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
          />
          {photos.length > 1 && (
            <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1">
              <Icon icon="solar:gallery-bold" className="w-3.5 h-3.5" />
              {activeIndex + 1} / {photos.length}
            </div>
          )}
          {active.caption && (
            <div className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full max-w-[60%] truncate">
              {active.caption}
            </div>
          )}
        </button>

        {/* Thumbnails */}
        {photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveIndex(i)}
                className={`flex-shrink-0 w-20 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                  i === activeIndex ? "border-indigo-500" : "border-transparent hover:border-gray-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbnailUrl || p.url}
                  alt={p.altText || ""}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-bold" className="w-7 h-7" />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white p-3 rounded-full hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((i) => (i - 1 + photos.length) % photos.length);
                }}
                aria-label="Previous"
              >
                <Icon icon="solar:arrow-left-bold" className="w-6 h-6" />
              </button>
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white p-3 rounded-full hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((i) => (i + 1) % photos.length);
                }}
                aria-label="Next"
              >
                <Icon icon="solar:arrow-right-bold" className="w-6 h-6" />
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.url}
            alt={active.altText || active.caption || ""}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {active.caption && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-full max-w-[80%] truncate">
              {active.caption}
            </div>
          )}
        </div>
      )}
    </>
  );
}
