import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Minimize2, Sparkles, Copy, ChevronDown, Paperclip, FileText } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from './auth/AuthProvider';

interface AIChatPanelProps {
  projectId?: string;
  projectContext?: {
    name?: string;
    category?: string;
    prompt?: string;
    style?: string;
    mood?: string;
    aspectRatio?: string;
    colorPalette?: string;
    pacing?: string;
    duration?: number;
  };
  onApplyPrompt?: (prompt: string) => void;
}

interface AttachedFile {
  name: string;
  content: string;
  size: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isQuestion?: boolean;
  showImport?: boolean;
  attachedFiles?: AttachedFile[];
}

interface DefaultPrompt {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export function AIChatPanel({ projectId, projectContext, onApplyPrompt }: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('openai/gpt-4o-mini');
  const [showDefaultPrompts, setShowDefaultPrompts] = useState(true);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getAccessToken } = useAuth();

  const defaultPrompts: DefaultPrompt[] = [
    {
      id: 'generate-script',
      title: 'Generate Video Script',
      description: 'Create a detailed script for your video',
      prompt: `Help me create a detailed video script. I want to create a ${projectContext?.category || 'video'} about: ${projectContext?.prompt || 'my product/service'}. Please ask me clarifying questions to understand:
1. The main message or story I want to tell
2. Target audience
3. Key points to highlight
4. Desired tone and style
5. Call-to-action

Then generate a complete script with scene descriptions, dialogue, and visual directions.`
    },
    {
      id: 'improve-prompt',
      title: 'Improve My Prompt',
      description: 'Enhance and refine your video prompt',
      prompt: `I have this video prompt: "${projectContext?.prompt || 'my video idea'}"

Please help me improve it by:
1. Asking clarifying questions about what I want to achieve
2. Suggesting specific visual elements, camera movements, and transitions
3. Adding details about mood, pacing, and style
4. Ensuring it's comprehensive enough for AI video generation

Let's refine this together step by step.`
    },
    {
      id: 'scene-breakdown',
      title: 'Scene Breakdown',
      description: 'Break down your video into detailed scenes',
      prompt: `Help me break down my video idea into detailed scenes. My concept is: "${projectContext?.prompt || 'my video idea'}"

Please:
1. Ask me about the duration and number of scenes I want
2. Help identify key moments and transitions
3. Create a scene-by-scene breakdown with:
   - Scene description
   - Visual elements
   - Camera movements
   - Timing
   - Transitions between scenes

Let's work through this together.`
    },
    {
      id: 'creative-ideas',
      title: 'Creative Ideas',
      description: 'Get creative suggestions for your video',
      prompt: `I'm working on a ${projectContext?.category || 'video'} project. My idea is: "${projectContext?.prompt || 'my video concept'}"

Please help me brainstorm:
1. Creative visual concepts and metaphors
2. Unique camera angles and movements
3. Color palettes and lighting styles
4. Music and sound design suggestions
5. Innovative transitions and effects

Ask me questions to better understand my vision, then provide creative recommendations.`
    }
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };

    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  const modelOptions = [
    {
      group: 'OpenAI',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fast' },
        { value: 'openai/gpt-4.5', label: 'GPT-4.5', description: 'Pro' },
      ],
    },
    {
      group: 'Anthropic',
      options: [
        { value: 'anthropic/claude-4.5-sonnet', label: 'Claude 4.5 Sonnet', description: 'Pro' },
      ],
    },
    {
      group: 'Google',
      options: [
        { value: 'google/gemini-flash-2.5', label: 'Gemini Flash 2.5', description: 'Fast' },
        { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Pro' },
      ],
    },
  ];

  const getSelectedModelLabel = () => {
    for (const group of modelOptions) {
      const option = group.options.find(opt => opt.value === selectedModel);
      if (option) return option.label;
    }
    return selectedModel;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: AttachedFile[] = [];
    
    for (const file of Array.from(files)) {
      // Only accept text files
      if (!file.type.startsWith('text/') && !file.name.match(/\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yaml|yml|log|csv)$/i)) {
        alert(`File "${file.name}" is not a text file. Please select only text files.`);
        continue;
      }

      try {
        const content = await file.text();
        newFiles.push({
          name: file.name,
          content: content,
          size: file.size,
        });
      } catch (error) {
        console.error(`Error reading file ${file.name}:`, error);
        alert(`Error reading file "${file.name}". Please try again.`);
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputMessage.trim() && attachedFiles.length === 0) || isLoading) return;

    // Build message content with attached files
    let messageContent = inputMessage.trim();
    if (attachedFiles.length > 0) {
      const fileContents = attachedFiles.map(file => 
        `\n\n[Attached file: ${file.name}]\n${file.content}`
      ).join('\n\n');
      messageContent = messageContent ? `${messageContent}${fileContents}` : `Please analyze the following attached files:${fileContents}`;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date(),
      attachedFiles: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    };

    // Build conversation history BEFORE adding current message
    const conversationHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const token = await getAccessToken();

      const response = await apiRequest<{
        response: string;
        conversationId: string;
      }>(
        '/api/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            message: messageContent,
            projectId: projectId,
            conversationId: conversationId,
            model: selectedModel,
            conversationHistory: conversationHistory,
            projectContext: projectContext,
          }),
        },
        token
      );

      // Detect if the response is asking questions
      const responseText = response.response;
      const isQuestion = /(\?|questions?|what|how|which|would you|do you|can you|tell me about)/i.test(responseText);
      
      // Check if user requested import in their message
      const userRequestedImport = /import/i.test(userMessage.content);
      
      // Check if assistant response contains final/ready keywords (more comprehensive)
      const hasFinalKeywords = /(final|ready|here'?s (?:your|the)|complete|finished|done|generated|created|script|prompt|video description|here is|below is)/i.test(responseText);
      
      // Also check if response contains structured content (code blocks, markdown, etc.)
      const hasStructuredContent = /```|```[\w]*\n|#+\s|^\*\*|^\* /m.test(responseText);
      
      // Show import button if:
      // 1. User explicitly requested import, OR
      // 2. Assistant says it's final/ready, OR
      // 3. Response has structured content (likely a script/prompt)
      const showImport = userRequestedImport || hasFinalKeywords || hasStructuredContent;

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        isQuestion,
        showImport,
      };

      setMessages(prev => [...prev, assistantMessage]);
      if (response.conversationId) {
        setConversationId(response.conversationId);
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message || 'Failed to get response'}. Please try again.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-8 bottom-8 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-110 transition-all flex items-center justify-center group"
        title="Open AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-black/20 animate-pulse" />
      </button>
    );
  }

  return (
    <div className="fixed right-0 top-12 h-[calc(100vh-3rem)] w-[500px] z-50 flex flex-col bg-black/20 backdrop-blur-xl border-l border-white/10 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-white/10">
            <MessageCircle className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
            <p className="text-xs text-white/50">Video creation help</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && showDefaultPrompts ? (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-white/10">
                <Sparkles className="w-6 h-6 text-blue-400" />
              </div>
              <p className="text-white/80 font-medium mb-1">How can I help you?</p>
              <p className="text-xs text-white/50">Choose a prompt or ask your own question</p>
            </div>
            
            <div className="space-y-2">
              {defaultPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => {
                    setInputMessage(prompt.prompt);
                    setShowDefaultPrompts(false);
                  }}
                  className="w-full text-left p-3 rounded-lg border border-white/10 bg-black/20 backdrop-blur-sm hover:bg-black/30 hover:border-white/20 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white/90 mb-1">{prompt.title}</p>
                      <p className="text-xs text-white/50">{prompt.description}</p>
                    </div>
                    <Send className="w-4 h-4 text-white/40 group-hover:text-white/60 transition-colors flex-shrink-0 mt-0.5" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-white/50 text-sm mt-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-white/10">
              <MessageCircle className="w-8 h-8 text-blue-400" />
            </div>
            <p className="text-white/70">Ask me anything about your video project!</p>
            <p className="text-xs mt-2 text-white/40">
              I can help with ideas, scripts, scene planning, and more.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                  message.role === 'user'
                    ? 'bg-gradient-to-r from-purple-500/80 to-pink-500/80 text-white shadow-lg shadow-purple-500/30 border border-purple-400/20'
                    : 'bg-black/40 backdrop-blur-sm text-white border border-white/20'
                }`}
              >
                {message.isQuestion && (
                  <div className="mb-2 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-xs text-blue-400/80 font-medium">Asking for clarification</span>
                  </div>
                )}
                {message.attachedFiles && message.attachedFiles.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {message.attachedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 border border-white/10">
                        <FileText className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white/90 truncate">{file.name}</p>
                          <p className="text-xs text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                {message.role === 'assistant' && onApplyPrompt && message.showImport && (
                  <button
                    onClick={() => {
                      // Try to extract the main prompt/script from the message
                      // Look for common patterns like "Here's your prompt:", "Final script:", etc.
                      let extractedPrompt = message.content;
                      
                      // Try to find a section marked as prompt/script
                      const promptPatterns = [
                        /(?:here'?s|final|your|the)\s+(?:video\s+)?(?:prompt|script|description)[:]\s*\n?\n?([\s\S]+?)(?:\n\n|\n---|\n###|$)/i,
                        /(?:prompt|script)[:]\s*\n?\n?([\s\S]+?)(?:\n\n|\n---|\n###|$)/i,
                        /```[\s\S]*?\n([\s\S]+?)\n```/,
                      ];
                      
                      for (const pattern of promptPatterns) {
                        const match = message.content.match(pattern);
                        if (match && match[1]) {
                          extractedPrompt = match[1].trim();
                          break;
                        }
                      }
                      
                      // Clean up the prompt (remove markdown formatting, extra whitespace)
                      extractedPrompt = extractedPrompt
                        .replace(/^\*\*|^\*|^#+\s*/gm, '') // Remove markdown bold/headers
                        .replace(/\*\*/g, '') // Remove bold markers
                        .replace(/```[\w]*\n?/g, '') // Remove code blocks
                        .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
                        .trim();
                      
                      onApplyPrompt(extractedPrompt);
                    }}
                    className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-blue-500/50 bg-gradient-to-r from-blue-500/20 to-purple-500/20 hover:from-blue-500/30 hover:to-purple-500/30 transition-all flex items-center gap-2 font-medium text-blue-300 hover:text-blue-200 shadow-sm hover:shadow-md"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Import to Prompt
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-black/30 backdrop-blur-sm text-white border border-white/10 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-sm text-white/70">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/10 bg-black/20 backdrop-blur-sm space-y-3">
        {/* Attached Files Display */}
        {attachedFiles.length > 0 && (
          <div className="space-y-1.5">
            {attachedFiles.map((file, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <FileText className="w-4 h-4 text-white/60 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate">{file.name}</p>
                  <p className="text-xs text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(idx)}
                  className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="Remove file"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.xml,.yaml,.yml,.log,.csv,text/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="file-attachment-input"
          />
          <label
            htmlFor="file-attachment-input"
            className="px-3 py-2.5 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/40 hover:border-white/20 transition-all cursor-pointer flex items-center justify-center self-end"
            title="Attach text file"
          >
            <Paperclip className="w-4 h-4" />
          </label>
          <textarea
            value={inputMessage}
            onChange={(e) => {
              setInputMessage(e.target.value);
              setShowDefaultPrompts(false);
            }}
            onFocus={() => setShowDefaultPrompts(false)}
            placeholder="Ask about your video project, generate scripts, or refine your prompt..."
            className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm resize-none min-h-[60px] max-h-[120px]"
            disabled={isLoading}
            rows={2}
          />
          <button
            type="submit"
            disabled={(!inputMessage.trim() && attachedFiles.length === 0) || isLoading}
            className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30 flex items-center justify-center self-end"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>

        {/* Model Selector - Custom Dropdown (Below Input) */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-white/50 whitespace-nowrap">
            Model:
          </label>
          <div className="flex-1 relative" ref={modelDropdownRef}>
            <button
              type="button"
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="w-full text-xs px-3 py-1.5 rounded-md border border-white/20 bg-black/40 backdrop-blur-md text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 cursor-pointer hover:bg-black/50 hover:border-white/30 transition-all duration-200 flex items-center justify-between group"
            >
              <span className="truncate">{getSelectedModelLabel()}</span>
              <ChevronDown className={`w-3 h-3 text-white/60 transition-transform duration-200 flex-shrink-0 ml-2 ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Custom Dropdown Menu - Opens Upward */}
            {isModelDropdownOpen && (
              <div className="absolute z-50 w-full bottom-full mb-2 rounded-lg border border-white/20 bg-black/95 backdrop-blur-xl shadow-2xl overflow-hidden animate-scale-in-bottom origin-bottom">
                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                  {modelOptions.map((group, groupIdx) => (
                    <div key={group.group}>
                      {groupIdx > 0 && <div className="h-px bg-white/10" />}
                      <div className="px-2.5 py-1.5 bg-black/50 border-b border-white/5">
                        <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                          {group.group}
                        </p>
                      </div>
                      {group.options.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setSelectedModel(option.value);
                            setIsModelDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs transition-all duration-150 ${
                            selectedModel === option.value
                              ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border-l-2 border-blue-400'
                              : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{option.label}</span>
                            {option.description && (
                              <span className="text-xs text-white/50 ml-2">{option.description}</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

