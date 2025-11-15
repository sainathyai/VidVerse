"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { projectSchema, type ProjectFormData, validateAudioFile } from "@/lib/validations";
import { uploadFile } from "@/lib/upload";
import { AudioWaveform } from "@/components/AudioWaveform";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import Link from "next/link";

function NewProjectContent() {
  const [currentStep, setCurrentStep] = useState(1);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      mode: "classic",
      duration: 60,
    },
  });

  const category = watch("category");

  const onSubmit = async (data: ProjectFormData) => {
    try {
      const projectData = {
        ...data,
        audioUrl: audioUrl || undefined, // Include uploaded audio URL if available
      };

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectData),
      });

      if (!response.ok) {
        throw new Error('Failed to create project');
      }

      const project = await response.json();
      // Redirect to project page
      window.location.href = `/project/${project.id}`;
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project. Please try again.');
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate audio file
      const validation = validateAudioFile(file);
      
      if (!validation.valid) {
        alert(validation.error);
        e.target.value = '';
        return;
      }
      
      setUploadedAudio(file);
      setAudioUrl(URL.createObjectURL(file));
      
      // Auto-upload file
      try {
        setUploading(true);
        const publicUrl = await uploadFile(file, "audio", (progress) => {
          setUploadProgress(progress);
        });
        setAudioUrl(publicUrl);
      } catch (error) {
        console.error("Upload error:", error);
        alert("Failed to upload audio file. Please try again.");
      } finally {
        setUploading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="text-muted hover:text-white mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-white mb-2">Create New Project</h1>
          <p className="text-muted">Build your AI video generation project step by step</p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-between">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all duration-300 ${
                  step === currentStep
                    ? "bg-primary-500 text-white scale-110"
                    : step < currentStep
                    ? "bg-success text-white"
                    : "bg-surface border-2 border-white/20 text-muted"
                }`}
              >
                {step < currentStep ? "✓" : step}
              </div>
              {step < 3 && (
                <div
                  className={`flex-1 h-1 mx-2 transition-all duration-300 ${
                    step < currentStep ? "bg-success" : "bg-surface"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Step 1: Category & Basic Info */}
          {currentStep === 1 && (
            <div className="rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6 space-y-6">
              <h2 className="text-2xl font-semibold text-white mb-4">Project Details</h2>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Category <span className="text-danger">*</span>
                </label>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { value: "music_video", label: "Music Video", icon: "🎵" },
                    { value: "ad_creative", label: "Ad Creative", icon: "📢" },
                    { value: "explainer", label: "Explainer", icon: "📚" },
                  ].map((cat) => (
                    <label
                      key={cat.value}
                      className={`cursor-pointer rounded-lg border-2 p-4 text-center transition-all duration-200 ${
                        category === cat.value
                          ? "border-primary-500 bg-primary-500/20"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <input
                        type="radio"
                        value={cat.value}
                        {...register("category")}
                        className="hidden"
                      />
                      <div className="text-3xl mb-2">{cat.icon}</div>
                      <div className="text-sm font-medium text-white">{cat.label}</div>
                    </label>
                  ))}
                </div>
                {errors.category && (
                  <p className="text-danger text-sm mt-1">{errors.category.message}</p>
                )}
              </div>

              {/* Prompt */}
              <div>
                <label htmlFor="prompt" className="block text-sm font-medium text-white mb-2">
                  Video Prompt <span className="text-danger">*</span>
                </label>
                <textarea
                  id="prompt"
                  {...register("prompt")}
                  rows={4}
                  className="w-full rounded-lg border border-white/10 bg-surface px-4 py-3 text-white placeholder-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  placeholder="Describe the video you want to create... e.g., 'A cyberpunk music video with neon lights and futuristic cityscapes'"
                />
                {errors.prompt && (
                  <p className="text-danger text-sm mt-1">{errors.prompt.message}</p>
                )}
              </div>

              {/* Duration */}
              <div>
                <label htmlFor="duration" className="block text-sm font-medium text-white mb-2">
                  Duration (seconds) <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  id="duration"
                  {...register("duration", { valueAsNumber: true })}
                  min={15}
                  max={300}
                  className="w-full rounded-lg border border-white/10 bg-surface px-4 py-3 text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                />
                {errors.duration && (
                  <p className="text-danger text-sm mt-1">{errors.duration.message}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="w-full bg-gradient-to-r from-primary-500 to-primary-600 text-white py-3 rounded-lg font-medium hover:shadow-lg hover:shadow-primary-500/30 transition-all duration-200"
              >
                Next: Style & Settings
              </button>
            </div>
          )}

          {/* Step 2: Style & Settings */}
          {currentStep === 2 && (
            <div className="rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6 space-y-6">
              <h2 className="text-2xl font-semibold text-white mb-4">Style & Settings</h2>

              {/* Style */}
              <div>
                <label htmlFor="style" className="block text-sm font-medium text-white mb-2">
                  Visual Style
                </label>
                <input
                  type="text"
                  id="style"
                  {...register("style")}
                  className="w-full rounded-lg border border-white/10 bg-surface px-4 py-3 text-white placeholder-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  placeholder="e.g., cinematic, animated, realistic, abstract"
                />
              </div>

              {/* Mood */}
              <div>
                <label htmlFor="mood" className="block text-sm font-medium text-white mb-2">
                  Mood
                </label>
                <input
                  type="text"
                  id="mood"
                  {...register("mood")}
                  className="w-full rounded-lg border border-white/10 bg-surface px-4 py-3 text-white placeholder-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  placeholder="e.g., energetic, calm, mysterious, joyful"
                />
              </div>

              {/* Mode Toggle */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Generation Mode
                </label>
                <div className="flex gap-4">
                  {[
                    { value: "classic", label: "Classic", desc: "Fast, deterministic" },
                    { value: "agentic", label: "Agentic", desc: "AI-powered refinement" },
                  ].map((mode) => (
                    <label
                      key={mode.value}
                      className={`flex-1 cursor-pointer rounded-lg border-2 p-4 transition-all duration-200 ${
                        watch("mode") === mode.value
                          ? "border-primary-500 bg-primary-500/20"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <input
                        type="radio"
                        value={mode.value}
                        {...register("mode")}
                        className="hidden"
                      />
                      <div className="font-semibold text-white mb-1">{mode.label}</div>
                      <div className="text-xs text-muted">{mode.desc}</div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="flex-1 bg-surface border border-white/10 text-white py-3 rounded-lg font-medium hover:bg-surface-hover transition-all duration-200"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="flex-1 bg-gradient-to-r from-primary-500 to-primary-600 text-white py-3 rounded-lg font-medium hover:shadow-lg hover:shadow-primary-500/30 transition-all duration-200"
                >
                  Next: Upload Assets
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Asset Upload */}
          {currentStep === 3 && (
            <div className="rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6 space-y-6">
              <h2 className="text-2xl font-semibold text-white mb-4">Upload Assets</h2>

              {/* Audio Upload */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Audio File {category === "music_video" && <span className="text-danger">*</span>}
                </label>
                <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center hover:border-primary-500/50 transition-all duration-200">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    className="hidden"
                    id="audio-upload"
                    disabled={uploading}
                  />
                  <label
                    htmlFor="audio-upload"
                    className={`cursor-pointer flex flex-col items-center ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className="text-4xl mb-4">🎵</div>
                    {uploadedAudio ? (
                      <div className="w-full">
                        <p className="text-white font-medium mb-1">{uploadedAudio.name}</p>
                        <p className="text-muted text-sm mb-4">
                          {(uploadedAudio.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {uploading && (
                          <div className="mb-4">
                            <div className="w-full bg-surface rounded-full h-2">
                              <div
                                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-muted text-xs mt-2">Uploading... {uploadProgress}%</p>
                          </div>
                        )}
                        {audioUrl && !uploading && (
                          <div className="mt-4">
                            <AudioWaveform audioUrl={audioUrl} height={80} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-white font-medium mb-1">Click to upload audio</p>
                        <p className="text-muted text-sm">MP3, WAV, M4A (max 50MB)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="flex-1 bg-surface border border-white/10 text-white py-3 rounded-lg font-medium hover:bg-surface-hover transition-all duration-200"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-gradient-to-r from-primary-500 to-primary-600 text-white py-3 rounded-lg font-medium hover:shadow-lg hover:shadow-primary-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Creating..." : "Create Project"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <ProtectedRoute>
      <NewProjectContent />
    </ProtectedRoute>
  );
}

