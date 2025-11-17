import { z } from "zod";

export const projectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100, "Project name must be less than 100 characters"),
  category: z.enum(["music_video", "ad_creative", "explainer"], {
    required_error: "Please select a category",
  }),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  duration: z.number().min(15, "Duration must be at least 15 seconds").max(300, "Duration must be less than 5 minutes"),
  style: z.string().optional(),
  mood: z.string().optional(),
  constraints: z.string().optional(),
  mode: z.enum(["classic", "agentic"]).default("classic"),
  audioUrl: z.string().url().optional(),
});

export type ProjectFormData = z.infer<typeof projectSchema>;

export const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/m4a", "audio/ogg"];
export const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB

export function validateAudioFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_AUDIO_TYPES.join(", ")}`,
    };
  }

  if (file.size > MAX_AUDIO_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_AUDIO_SIZE / 1024 / 1024}MB`,
    };
  }

  return { valid: true };
}

