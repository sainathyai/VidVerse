import { ArrowLeft, Settings, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface LeftPanelProps {
  category: "music_video" | "ad_creative" | "explainer";
  onCategoryChange: (category: "music_video" | "ad_creative" | "explainer") => void;
  style: string;
  onStyleChange: (style: string) => void;
  mood: string;
  onMoodChange: (mood: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (aspectRatio: string) => void;
  duration: number;
  onDurationChange: (duration: number) => void;
  colorPalette: string;
  onColorPaletteChange: (colorPalette: string) => void;
  pacing: string;
  onPacingChange: (pacing: string) => void;
  videoModelId: string;
  onVideoModelIdChange: (videoModelId: string) => void;
  imageModelId: string;
  onImageModelIdChange: (imageModelId: string) => void;
  useReferenceFrame: boolean;
  onUseReferenceFrameChange: (useReferenceFrame: boolean) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (includeAudio: boolean) => void;
  styleOptions: Array<{ value: string; label: string }>;
  moodOptions: Array<{ value: string; label: string }>;
  aspectRatioOptions: Array<{ value: string; label: string; description?: string }>;
  durationOptions: Array<{ value: number; label: string; description?: string }>;
  colorPaletteOptions: Array<{ value: string; label: string; description?: string }>;
  pacingOptions: Array<{ value: string; label: string; description?: string }>;
  videoModelOptions: Array<{ value: string; label: string }>;
  imageModelOptions: Array<{ value: string; label: string }>;
  glassSelectStyle: React.CSSProperties;
}

export function LeftPanel({
  category,
  onCategoryChange,
  style,
  onStyleChange,
  mood,
  onMoodChange,
  aspectRatio,
  onAspectRatioChange,
  duration,
  onDurationChange,
  colorPalette,
  onColorPaletteChange,
  pacing,
  onPacingChange,
  videoModelId,
  onVideoModelIdChange,
  imageModelId,
  onImageModelIdChange,
  useReferenceFrame,
  onUseReferenceFrameChange,
  includeAudio,
  onIncludeAudioChange,
  styleOptions,
  moodOptions,
  aspectRatioOptions,
  durationOptions,
  colorPaletteOptions,
  pacingOptions,
  videoModelOptions,
  imageModelOptions,
  glassSelectStyle,
}: LeftPanelProps) {
  const navigate = useNavigate();

  return (
    <div className="w-96 border-r border-white/10 bg-black/20 backdrop-blur-xl p-8 overflow-y-auto animate-slide-in-left flex flex-col">
      {/* Back to Dashboard Button */}
      <div className="mb-6 animate-fade-in">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">Back to Dashboard</span>
        </button>
      </div>

      <div className="space-y-5 flex-1">
        {/* Category Selection */}
        <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <label className="block text-sm font-medium text-white/70 mb-3 uppercase tracking-wider">
            Category <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-3">
            {[
              { value: "music_video", label: "Music", icon: "🎵" },
              { value: "ad_creative", label: "Ad", icon: "📢" },
              { value: "explainer", label: "Explain", icon: "📚" },
            ].map((cat, idx) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => onCategoryChange(cat.value as typeof category)}
                className={`flex-1 aspect-square flex flex-col items-center justify-center rounded-lg border backdrop-blur-md transition-all duration-300 transform hover:scale-[1.05] ${
                  category === cat.value
                    ? "border-blue-500/50 bg-gradient-to-br from-blue-500/20 to-purple-500/10 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500/20"
                    : "border-white/20 bg-gradient-to-br from-white/10 to-white/5 hover:border-white/30 hover:bg-gradient-to-br hover:from-white/15 hover:to-white/10 hover:shadow-md hover:shadow-white/10"
                }`}
                style={{ maxWidth: '80px', maxHeight: '80px', animationDelay: `${0.15 + idx * 0.05}s` }}
              >
                <span className="text-2xl mb-1">{cat.icon}</span>
                <span className="text-xs font-medium text-white">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Visual Style + Mood - Row 1 */}
        <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.3s' }}>
          {/* Visual Style */}
          <div className="flex-1">
            <label htmlFor="style" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Visual Style
            </label>
            <div className="relative group">
              <select
                id="style"
                value={style}
                onChange={(e) => onStyleChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {styleOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>

          {/* Mood */}
          <div className="flex-1">
            <label htmlFor="mood" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Mood
            </label>
            <div className="relative group">
              <select
                id="mood"
                value={mood}
                onChange={(e) => onMoodChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {moodOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>
        </div>

        {/* Aspect Ratio + Duration - Row 2 */}
        <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.4s' }}>
          {/* Aspect Ratio */}
          <div className="flex-1">
            <label htmlFor="aspectRatio" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Aspect Ratio
            </label>
            <div className="relative group">
              <select
                id="aspectRatio"
                value={aspectRatio}
                onChange={(e) => onAspectRatioChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {aspectRatioOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>

          {/* Duration */}
          <div className="flex-1">
            <label htmlFor="duration" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Duration
            </label>
            <div className="relative group">
              <select
                id="duration"
                value={duration}
                onChange={(e) => onDurationChange(Number(e.target.value))}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {durationOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>
        </div>

        {/* Color Palette + Pacing - Row 3 */}
        <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.5s' }}>
          {/* Color Palette */}
          <div className="flex-1">
            <label htmlFor="colorPalette" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Color Palette
            </label>
            <div className="relative group">
              <select
                id="colorPalette"
                value={colorPalette}
                onChange={(e) => onColorPaletteChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {colorPaletteOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>

          {/* Pacing */}
          <div className="flex-1">
            <label htmlFor="pacing" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Pacing
            </label>
            <div className="relative group">
              <select
                id="pacing"
                value={pacing}
                onChange={(e) => onPacingChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {pacingOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>
        </div>

        {/* Video and Image Models - Side by Side */}
        <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.6s' }}>
          {/* Video Models */}
          <div className="flex-1">
            <label htmlFor="videoModelId" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Video Models
            </label>
            <div className="relative group">
              <select
                id="videoModelId"
                value={videoModelId}
                onChange={(e) => onVideoModelIdChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {videoModelOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>

          {/* Image Models */}
          <div className="flex-1">
            <label htmlFor="imageModelId" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
              Image Models
            </label>
            <div className="relative group">
              <select
                id="imageModelId"
                value={imageModelId}
                onChange={(e) => onImageModelIdChange(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-2.5 py-2 text-sm text-white focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-gradient-to-br hover:from-blue-500/25 hover:via-purple-500/20 hover:to-pink-500/15 hover:border-white/30 hover:shadow-md shadow-inner"
                style={glassSelectStyle}
              >
                {imageModelOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/60 group-hover:text-white/80 transition-colors">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </span>
            </div>
          </div>
        </div>

        {/* Include Audio Checkbox */}
        <div className="animate-fade-in" style={{ animationDelay: '0.65s' }}>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(e) => onIncludeAudioChange(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-white/70 group-hover:text-white transition-colors">
              Include audio in generated videos
            </span>
          </label>
          <p className="mt-1 ml-6 text-xs text-white/50">
            Generate videos with AI-generated audio (unchecked = silent videos)
          </p>
        </div>

        {/* Use Reference Frame Checkbox */}
        <div className="animate-fade-in" style={{ animationDelay: '0.7s' }}>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={useReferenceFrame}
              onChange={(e) => onUseReferenceFrameChange(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-white/70 group-hover:text-white transition-colors">
              Use last frame as reference for scene transitions
            </span>
          </label>
          <p className="mt-1 ml-6 text-xs text-white/50">
            Helps maintain visual continuity between scenes (may trigger content filters)
          </p>
        </div>
      </div>

      {/* Settings Label at Bottom */}
      <div className="mt-auto pt-6 border-t border-white/10">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white/70">Settings</h2>
        </div>
      </div>
    </div>
  );
}

