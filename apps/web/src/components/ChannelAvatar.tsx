import type { ReactNode } from "react";

/**
 * Avatar channel + badge provider (Fase 6H — kartu Channels mengikuti
 * referensi UI user). Slot avatar SIAP-GAMBAR: bila `imageUrl` tersedia
 * (foto channel/bot tiba di Fase 6D) ia dirender sebagai <img>; selama
 * belum ada, slot menampilkan inisial nama di atas tint warna provider.
 * Badge kecil di pojok kanan-bawah avatar selalu glyph provider di atas
 * warna merek provider — sama seperti badge Instagram pada referensi.
 *
 * Warna merek di sini BUKAN token tema: ini identitas provider pihak
 * ketiga (seperti logo), jadi hex merek memang disengaja dan konsisten
 * di tema terang maupun gelap.
 */
export interface ProviderMeta {
  /** Warna merek provider (badge + tint avatar). */
  color: string;
  /** Glyph provider (SVG 24x24, digambar dengan stroke currentColor). */
  glyph: ReactNode;
}

const GLYPH_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const PROVIDER_META: Record<string, ProviderMeta> = {
  telegram: {
    color: "#229ED9",
    glyph: (
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    ),
  },
  webchat: {
    color: "#2563EB",
    glyph: (
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    ),
  },
  whatsapp: {
    color: "#25D366",
    glyph: (
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    ),
  },
  instagram: {
    color: "#E4405F",
    glyph: (
      <>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <path d="M17.5 6.5h.01" />
      </>
    ),
  },
  messenger: {
    color: "#0084FF",
    glyph: (
      <>
        <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.1L3 21l2.4-5.6A8.5 8.5 0 1 1 21 11.5z" />
        <path d="M13.2 8.2 9.4 12.6h2.7l-1 3.4 3.8-4.4h-2.7l1-3.4z" />
      </>
    ),
  },
};

const FALLBACK_META: ProviderMeta = PROVIDER_META.webchat;

export function providerMeta(provider: string): ProviderMeta {
  return PROVIDER_META[provider] ?? FALLBACK_META;
}

/** Glyph provider berdiri sendiri (dipakai badge & kartu provider "segera"). */
export function ProviderGlyph({
  provider,
  className = "h-5 w-5",
  strokeWidth = 1.8,
}: {
  provider: string;
  className?: string;
  strokeWidth?: number;
}) {
  const meta = providerMeta(provider);
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      strokeWidth={strokeWidth}
      aria-hidden={true}
      {...GLYPH_PROPS}
    >
      {meta.glyph}
    </svg>
  );
}

interface ChannelAvatarProps {
  provider: string;
  /** Nama untuk inisial fallback (displayName / username / label provider). */
  name: string;
  /** URL foto channel — diisi Fase 6D; selama undefined tampil inisial. */
  imageUrl?: string;
}

/**
 * Slot avatar persegi membulat + badge provider di pojok kanan-bawah.
 */
export function ChannelAvatar({ provider, name, imageUrl }: ChannelAvatarProps) {
  const meta = providerMeta(provider);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <div className="relative shrink-0">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="h-12 w-12 rounded-xl border border-line object-cover"
        />
      ) : (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
          aria-hidden={true}
        >
          {initial}
        </div>
      )}
      <span
        className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-surface"
        style={{ backgroundColor: meta.color }}
        aria-hidden={true}
      >
        <ProviderGlyph provider={provider} className="h-3 w-3" strokeWidth={2.4} />
      </span>
    </div>
  );
}
