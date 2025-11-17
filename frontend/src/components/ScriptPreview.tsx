import { X, FileText } from "lucide-react";
import { useState } from "react";

interface ScriptPreviewProps {
  script: string;
  onClose?: () => void;
}

export function ScriptPreview({ script, onClose }: ScriptPreviewProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
      >
        <FileText className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Script Preview
          </h2>
          <button
            onClick={() => {
              setIsOpen(false);
              onClose?.();
            }}
            className="p-1 hover:bg-accent rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
            {script}
          </pre>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(script);
            }}
            className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md"
          >
            Copy Script
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              onClose?.();
            }}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

