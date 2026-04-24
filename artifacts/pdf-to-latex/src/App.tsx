import { useState, useRef, useCallback, useEffect } from "react";
import {
  FileData,
  convertToLatex,
  listUsableGeminiModels,
  verifyModel,
  assembleLatex,
  AnswerMode,
  SolutionMode,
} from "./lib/gemini";
import { LATEX_TEMPLATE } from "./lib/template";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card } from "./components/ui/card";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { useToast } from "./hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./components/ui/dialog";
import {
  Upload,
  Image as ImageIcon,
  FileText,
  Check,
  Settings,
  Copy,
  Save,
  KeyRound,
  Loader2,
  X,
  GripVertical,
  Moon,
  Sun,
  ChevronDown,
  ListChecks,
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { ScrollArea } from "./components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover";
import { useTheme } from "./hooks/use-theme";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// ---------- File helpers ----------

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.onerror = () => reject(new Error("Đọc tệp thất bại"));
    reader.readAsDataURL(file);
  });
}

const ACCEPT_MIME = /^(application\/pdf|image\/(png|jpe?g|webp))$/;

// ---------- File list with drag reorder ----------

function FileList({
  files,
  setFiles,
  height = "h-[260px]",
  emptyText = "Chưa có tệp nào.",
}: {
  files: FileData[];
  setFiles: React.Dispatch<React.SetStateAction<FileData[]>>;
  height?: string;
  emptyText?: string;
}) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const _files = [...files];
    const dragged = _files.splice(dragItem.current, 1)[0];
    _files.splice(dragOverItem.current, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    setFiles(_files);
  };

  const removeFile = (index: number) =>
    setFiles(files.filter((_, i) => i !== index));

  return (
    <ScrollArea
      className={`${height} w-full rounded-xl border border-border/60 bg-muted/30`}
    >
      <div className="flex flex-col gap-2 p-3">
        {files.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-10">
            <ListChecks className="h-6 w-6 mb-2 opacity-50" />
            {emptyText}
          </div>
        )}
        {files.map((file, index) => (
          <div
            key={`${file.file.name}-${index}`}
            draggable
            onDragStart={() => (dragItem.current = index)}
            onDragEnter={() => (dragOverItem.current = index)}
            onDragEnd={handleSort}
            onDragOver={(e) => e.preventDefault()}
            className="flex items-center gap-3 bg-background border border-border/60 rounded-xl p-2.5 shadow-sm cursor-grab hover:border-primary transition-colors"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="h-10 w-10 flex-shrink-0 bg-muted rounded-lg overflow-hidden flex items-center justify-center">
              {file.file.type.startsWith("image/") ? (
                <img
                  src={`data:${file.file.type};base64,${file.base64}`}
                  alt="thumbnail"
                  className="h-full w-full object-cover"
                />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-sm font-medium truncate">
                {file.file.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {(file.file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums px-1">
              {index + 1}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => removeFile(index)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ---------- Reusable upload zone ----------

interface UploadZoneProps {
  files: FileData[];
  setFiles: React.Dispatch<React.SetStateAction<FileData[]>>;
  inputId: string;
  variant?: "tall" | "compact";
  title?: string;
  hint?: string;
}

function UploadZone({
  files: _files,
  setFiles,
  inputId,
  variant = "tall",
  title,
  hint,
}: UploadZoneProps) {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const zoneRef = useRef<HTMLDivElement | null>(null);

  const handleFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;
      const filtered = incoming.filter((f) => ACCEPT_MIME.test(f.type));
      if (filtered.length === 0) {
        toast({
          title: "Định dạng không hỗ trợ",
          description: "Chỉ chấp nhận PDF hoặc ảnh PNG/JPG/WEBP.",
          variant: "destructive",
        });
        return;
      }

      const newOnes: FileData[] = [];
      for (const f of filtered) {
        newOnes.push({ file: f, base64: await fileToBase64(f) });
      }
      setFiles((prev) => [...prev, ...newOnes]);
    },
    [setFiles, toast],
  );

  // Paste support, scoped to this zone (focus required) and to the document
  const onPaste = useCallback(
    async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Ignore paste happening inside text inputs / textareas / contenteditables
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target.isContentEditable) {
          return;
        }
      }

      // Only handle if the focus is within this zone (or zone is "active")
      const zoneEl = zoneRef.current;
      if (!zoneEl) return;
      const isActive =
        zoneEl.contains(document.activeElement) ||
        zoneEl.matches(":hover");
      if (!isActive) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      const collected: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) collected.push(f);
        }
      }
      if (collected.length > 0) {
        e.preventDefault();
        await handleFiles(collected);
      }
    },
    [handleFiles],
  );

  useEffect(() => {
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onPaste]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const heightClass = variant === "tall" ? "min-h-[180px]" : "min-h-[120px]";

  return (
    <div
      ref={zoneRef}
      tabIndex={0}
      className={`outline-none border-2 border-dashed rounded-xl ${heightClass} p-5 text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-2 ${
        isDragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => document.getElementById(inputId)?.click()}
    >
      <input
        type="file"
        id={inputId}
        multiple
        accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <div className="p-2 bg-primary/10 rounded-full text-primary">
        <ImageIcon
          className={variant === "tall" ? "h-7 w-7" : "h-5 w-5"}
        />
      </div>
      {title && (
        <p className="text-sm font-semibold leading-tight">{title}</p>
      )}
      <p className="text-xs text-muted-foreground leading-snug px-2">
        {hint || "Kéo thả, click chọn, hoặc Ctrl+V để dán tệp/ảnh"}
      </p>
    </div>
  );
}

// ---------- Model picker popover ----------

function ModelPicker({
  apiKey,
  models,
  selectedModel,
  setSelectedModel,
  verifiedModel,
  onVerified,
}: {
  apiKey: string;
  models: string[];
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  verifiedModel: string | null;
  onVerified: (m: string | null) => void;
}) {
  const { toast } = useToast();
  const [verifyingModel, setVerifyingModel] = useState<string | null>(null);

  const pickModel = async (m: string) => {
    setVerifyingModel(m);
    try {
      await verifyModel(apiKey, m);
      setSelectedModel(m);
      onVerified(m);
      localStorage.setItem("gemini_model", m);
      toast({
        title: "Kết nối thành công",
        description: `Đã kết nối đến model ${m} đã chọn.`,
      });
    } catch (err: any) {
      onVerified(null);
      toast({
        title: "Không khả dụng",
        description: `${m} hiện không khả dụng${
          err?.message ? `: ${err.message}` : ""
        }`,
        variant: "destructive",
      });
    } finally {
      setVerifyingModel(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 max-w-[220px] truncate shrink-0"
          disabled={models.length === 0}
        >
          <Sparkles className="h-4 w-4 mr-2 text-primary" />
          <span className="truncate">
            {verifiedModel || selectedModel || "Chọn model"}
          </span>
          <ChevronDown className="h-4 w-4 ml-2 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-medium">Models khả dụng</p>
          <p className="text-xs text-muted-foreground">
            Chỉ liệt kê các model còn quota dùng được. Click để xác nhận kết nối.
          </p>
        </div>
        <ScrollArea className="max-h-[280px]">
          <div className="flex flex-col p-1">
            {models.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                Chưa có dữ liệu. Bấm "Kiểm tra" trước.
              </div>
            )}
            {models.map((m) => (
              <button
                key={m}
                onClick={() => pickModel(m)}
                disabled={verifyingModel !== null}
                className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-sm"
              >
                {verifyingModel === m ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : verifiedModel === m ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />
                )}
                <span className="truncate flex-1">{m}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Main page ----------

const ANSWER_LABEL: Record<AnswerMode, string> = {
  ai: "Sử dụng đáp án AI",
  available: "Sử dụng đáp án sẵn có",
  both: "Sử dụng đáp án AI và đáp án sẵn có",
};
const SOLUTION_LABEL: Record<SolutionMode, string> = {
  ai: "Sử dụng lời giải AI",
  available: "Sử dụng lời giải sẵn có",
  both: "Sử dụng lời giải AI và lời giải sẵn có",
};

function Home() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  // API key + models
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("gemini_api_key") || "",
  );
  const [checkingKey, setCheckingKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem("gemini_model") || "",
  );
  const [verifiedModel, setVerifiedModel] = useState<string | null>(null);

  // File buckets
  const [questionFiles, setQuestionFiles] = useState<FileData[]>([]);
  const [answerFiles, setAnswerFiles] = useState<FileData[]>([]);
  const [solutionFiles, setSolutionFiles] = useState<FileData[]>([]);

  // Modes
  const [answerMode, setAnswerMode] = useState<AnswerMode>(
    () =>
      (localStorage.getItem("answer_mode") as AnswerMode | null) || "ai",
  );
  const [solutionMode, setSolutionMode] = useState<SolutionMode>(
    () =>
      (localStorage.getItem("solution_mode") as SolutionMode | null) || "ai",
  );

  useEffect(
    () => localStorage.setItem("answer_mode", answerMode),
    [answerMode],
  );
  useEffect(
    () => localStorage.setItem("solution_mode", solutionMode),
    [solutionMode],
  );

  // Conversion
  const [isConverting, setIsConverting] = useState(false);
  const [latexOutput, setLatexOutput] = useState("");

  // Settings (Tinh chỉnh đề)
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem("exam_settings");
    return saved
      ? JSON.parse(saved)
      : { tende: "ĐỀ MINH HOẠ", made: "01", thoigian: 90 };
  });
  const [tempSettings, setTempSettings] = useState(settings);

  // ----- API key check -----
  const checkApiKey = async () => {
    if (!apiKey) {
      toast({
        title: "Thiếu khóa",
        description: "Vui lòng nhập khóa API Gemini.",
        variant: "destructive",
      });
      return;
    }
    setCheckingKey(true);
    setVerifiedModel(null);
    try {
      const usable = await listUsableGeminiModels(apiKey);
      setModels(usable);
      localStorage.setItem("gemini_api_key", apiKey);
      if (usable.length === 0) {
        toast({
          title: "Không có model khả dụng",
          description:
            "Khóa hợp lệ nhưng không model nào còn quota miễn phí dùng được.",
          variant: "destructive",
        });
      } else {
        if (!usable.includes(selectedModel)) {
          setSelectedModel(usable[0]);
        }
        toast({
          title: "Đã tìm thấy model khả dụng",
          description: `${usable.length} model còn dùng được. Mở danh sách để chọn.`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Không thể kết nối Gemini",
        description: err.message || String(err),
        variant: "destructive",
      });
      setModels([]);
    } finally {
      setCheckingKey(false);
    }
  };

  // ----- Convert -----
  const doConvert = async () => {
    if (!apiKey) {
      toast({
        title: "Thiếu khóa",
        description: "Vui lòng nhập khóa API Gemini.",
        variant: "destructive",
      });
      return;
    }
    if (!verifiedModel) {
      toast({
        title: "Chưa chọn model",
        description:
          "Bấm Kiểm tra rồi chọn một model khả dụng trong danh sách.",
        variant: "destructive",
      });
      return;
    }
    if (questionFiles.length === 0) {
      toast({
        title: "Thiếu tệp câu hỏi",
        description: "Vui lòng tải lên ít nhất một tệp ở vùng Tải tệp lên.",
        variant: "destructive",
      });
      return;
    }

    // Validate side files for available/both modes
    const needAnswer = answerMode === "available" || answerMode === "both";
    const needSolution = solutionMode === "available" || solutionMode === "both";
    const missingAnswer = needAnswer && answerFiles.length === 0;
    const missingSolution = needSolution && solutionFiles.length === 0;

    if (missingAnswer && missingSolution) {
      toast({
        title: "Thiếu tệp",
        description:
          "Vui lòng thêm đáp án sẵn có vào vùng thiết lập đáp án và lời giải sẵn có vào vùng thiết lập lời giải.",
        variant: "destructive",
      });
      return;
    }
    if (missingAnswer) {
      toast({
        title: "Thiếu đáp án sẵn có",
        description:
          "Bạn đã chọn dùng đáp án sẵn có. Vui lòng thêm tệp/ảnh vào vùng thiết lập đáp án.",
        variant: "destructive",
      });
      return;
    }
    if (missingSolution) {
      toast({
        title: "Thiếu lời giải sẵn có",
        description:
          "Bạn đã chọn dùng lời giải sẵn có. Vui lòng thêm tệp/ảnh vào vùng thiết lập lời giải.",
        variant: "destructive",
      });
      return;
    }

    setIsConverting(true);
    setLatexOutput("");
    try {
      const output = await convertToLatex(
        apiKey,
        verifiedModel,
        questionFiles,
        answerFiles,
        solutionFiles,
        answerMode,
        solutionMode,
      );
      if (!output || output.trim() === "") {
        throw new Error("Gemini không trả về kết quả hợp lệ. Hãy thử lại.");
      }
      const finalDoc = assembleLatex(
        LATEX_TEMPLATE,
        settings.tende,
        settings.made,
        settings.thoigian.toString(),
        output,
      );
      setLatexOutput(finalDoc);
      toast({
        title: "Thành công",
        description: "Đã chuyển đổi xong sang LaTeX.",
      });
    } catch (err: any) {
      toast({
        title: "Lỗi chuyển đổi",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setIsConverting(false);
    }
  };

  const saveSettings = () => {
    setSettings(tempSettings);
    localStorage.setItem("exam_settings", JSON.stringify(tempSettings));
    setShowSettings(false);
  };

  const copyToClipboard = async () => {
    if (!latexOutput) return;
    try {
      await navigator.clipboard.writeText(latexOutput);
      toast({ title: "Đã sao chép", description: "Đã sao chép mã LaTeX." });
    } catch {
      toast({
        title: "Lỗi",
        description: "Không thể sao chép.",
        variant: "destructive",
      });
    }
  };

  const downloadFile = async () => {
    if (!latexOutput) return;
    const filename = `${settings.tende.replace(/[^a-zA-Z0-9]/g, "_")}_${
      settings.made
    }.tex`;
    try {
      if ("showSaveFilePicker" in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "LaTeX File",
              accept: { "text/plain": [".tex"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(latexOutput);
        await writable.close();
      } else {
        const blob = new Blob([latexOutput], {
          type: "text/plain;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast({ title: "Đã lưu tệp" });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast({
          title: "Lỗi",
          description: "Không thể lưu tệp.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col font-sans">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-semibold hidden md:block tracking-tight text-primary">
              Trình chuyển đổi PDF / Ảnh sang LaTeX
            </h1>
            <h1 className="text-xl font-semibold md:hidden tracking-tight text-primary">
              PDF → LaTeX
            </h1>
          </div>

          <div className="flex flex-1 md:flex-none items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="hidden sm:flex shrink-0"
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>

            <ModelPicker
              apiKey={apiKey}
              models={models}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              verifiedModel={verifiedModel}
              onVerified={setVerifiedModel}
            />

            <div className="relative flex-1 max-w-[260px]">
              <KeyRound className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Nhập khóa API từ aistudio..."
                className="pl-9 h-9"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && checkApiKey()}
              />
            </div>
            <Button
              onClick={checkApiKey}
              disabled={checkingKey}
              size="sm"
              className="h-9 shrink-0"
            >
              {checkingKey ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2 hidden sm:block" />
              )}
              Kiểm tra
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 flex flex-col gap-6">
        {/* TOP ROW: Upload | File list */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Tải tệp lên
            </h2>
            <UploadZone
              files={questionFiles}
              setFiles={setQuestionFiles}
              inputId="upload-questions"
              variant="tall"
              title="Kéo thả, click chọn, hoặc Ctrl+V để dán"
              hint="Nhận nhiều tệp PDF hoặc nhiều ảnh (PNG, JPG, WEBP)"
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              Danh sách tệp đã tải lên
              <Badge variant="secondary" className="ml-1">
                {questionFiles.length}
              </Badge>
            </h2>
            <FileList
              files={questionFiles}
              setFiles={setQuestionFiles}
              height="h-[260px]"
              emptyText="Chưa có tệp câu hỏi nào."
            />
          </div>
        </section>

        {/* MIDDLE ROW: Settings | Answer files | Solution files */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Zone 1: Thiết lập đề thi */}
          <Card className="p-5 flex flex-col gap-3 rounded-2xl">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Vùng thiết lập đề thi
            </h2>

            <div className="grid grid-cols-1 gap-2.5">
              <Button
                variant="outline"
                className="justify-between h-10 rounded-xl"
                onClick={() => {
                  setTempSettings(settings);
                  setShowSettings(true);
                }}
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Tinh chỉnh đề
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 -rotate-90" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-between h-10 rounded-xl text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">Thiết lập đáp án</span>
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[320px]">
                  <DropdownMenuLabel>Thiết lập đáp án</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={answerMode}
                    onValueChange={(v) => {
                      const next = v as AnswerMode;
                      setAnswerMode(next);
                      if (next === "available" || next === "both") {
                        toast({
                          title: "Cần đáp án sẵn có",
                          description:
                            "Hãy thêm tệp/ảnh đáp án sẵn có vào vùng đáp án bên cạnh.",
                        });
                      }
                    }}
                  >
                    <DropdownMenuRadioItem value="ai">
                      {ANSWER_LABEL.ai}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="available">
                      {ANSWER_LABEL.available}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="both">
                      {ANSWER_LABEL.both}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-between h-10 rounded-xl text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <BookOpen className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">Thiết lập lời giải</span>
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[320px]">
                  <DropdownMenuLabel>Thiết lập lời giải</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={solutionMode}
                    onValueChange={(v) => {
                      const next = v as SolutionMode;
                      setSolutionMode(next);
                      if (next === "available" || next === "both") {
                        toast({
                          title: "Cần lời giải sẵn có",
                          description:
                            "Hãy thêm tệp/ảnh lời giải sẵn có vào vùng lời giải bên cạnh.",
                        });
                      }
                    }}
                  >
                    <DropdownMenuRadioItem value="ai">
                      {SOLUTION_LABEL.ai}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="available">
                      {SOLUTION_LABEL.available}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="both">
                      {SOLUTION_LABEL.both}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Visual summary fills remaining vertical space */}
            <div className="mt-1 flex-1 flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Tóm tắt thiết lập hiện tại
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Tên đề</span>
                <span className="font-medium truncate text-right">
                  {settings.tende}
                </span>
                <span className="text-muted-foreground">Mã đề</span>
                <span className="font-medium text-right">{settings.made}</span>
                <span className="text-muted-foreground">Thời gian</span>
                <span className="font-medium text-right">
                  {settings.thoigian} phút
                </span>
              </div>
              <div className="border-t border-border/50 my-1" />
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="leading-snug">
                    <span className="text-muted-foreground">Đáp án: </span>
                    <span className="font-medium">
                      {ANSWER_LABEL[answerMode]}
                    </span>
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="leading-snug">
                    <span className="text-muted-foreground">Lời giải: </span>
                    <span className="font-medium">
                      {SOLUTION_LABEL[solutionMode]}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Zone 2: Đáp án sẵn có */}
          <Card className="p-5 flex flex-col gap-3 rounded-2xl">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Đáp án sẵn có
              <Badge variant="secondary" className="ml-1">
                {answerFiles.length}
              </Badge>
            </h2>
            <UploadZone
              files={answerFiles}
              setFiles={setAnswerFiles}
              inputId="upload-answers"
              variant="compact"
              title="Thêm tệp/ảnh đáp án"
              hint="Kéo thả / click / Ctrl+V — PDF hoặc ảnh"
            />
            <FileList
              files={answerFiles}
              setFiles={setAnswerFiles}
              height="h-[170px]"
              emptyText="Chưa có tệp/ảnh đáp án sẵn có."
            />
          </Card>

          {/* Zone 3: Lời giải sẵn có */}
          <Card className="p-5 flex flex-col gap-3 rounded-2xl">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Lời giải sẵn có
              <Badge variant="secondary" className="ml-1">
                {solutionFiles.length}
              </Badge>
            </h2>
            <UploadZone
              files={solutionFiles}
              setFiles={setSolutionFiles}
              inputId="upload-solutions"
              variant="compact"
              title="Thêm tệp/ảnh lời giải"
              hint="Kéo thả / click / Ctrl+V — PDF hoặc ảnh"
            />
            <FileList
              files={solutionFiles}
              setFiles={setSolutionFiles}
              height="h-[170px]"
              emptyText="Chưa có tệp/ảnh lời giải sẵn có."
            />
          </Card>
        </section>

        {/* CONVERT BUTTON + INFO */}
        <section className="flex flex-col items-center gap-3 py-2">
          <Button
            size="lg"
            className="h-16 px-12 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all min-w-[260px]"
            onClick={doConvert}
            disabled={isConverting}
          >
            {isConverting ? (
              <>
                <Loader2 className="h-6 w-6 mr-3 animate-spin" />
                Đang chuyển đổi…
              </>
            ) : (
              "CHUYỂN ĐỔI"
            )}
          </Button>
          <div className="flex flex-wrap gap-2 justify-center">
            <Badge
              variant="outline"
              className="text-sm py-1 px-3 bg-background font-medium"
            >
              Tên đề: {settings.tende}
            </Badge>
            <Badge
              variant="outline"
              className="text-sm py-1 px-3 bg-background font-medium"
            >
              Thời gian: {settings.thoigian} phút
            </Badge>
            <Badge
              variant="outline"
              className="text-sm py-1 px-3 bg-background font-medium"
            >
              Mã đề: {settings.made}
            </Badge>
          </div>
        </section>

        {/* OUTPUT AREA */}
        <div className="flex flex-col gap-4 flex-1 mt-2 min-h-[400px]">
          <h2 className="text-lg font-medium">Kết quả LaTeX</h2>
          <div className="flex-1 relative rounded-xl border bg-muted/20 overflow-hidden group shadow-inner">
            <textarea
              className="w-full h-full min-h-[400px] p-6 font-mono text-sm leading-relaxed bg-transparent resize-none focus:outline-none"
              value={latexOutput}
              onChange={(e) => setLatexOutput(e.target.value)}
              placeholder="Mã LaTeX sẽ hiển thị ở đây..."
              spellCheck={false}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={copyToClipboard}
              disabled={!latexOutput}
            >
              <Copy className="h-5 w-5 mr-2" /> Sao chép
            </Button>
            <Button size="lg" onClick={downloadFile} disabled={!latexOutput}>
              <Save className="h-5 w-5 mr-2" /> Lưu tệp
            </Button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Tinh chỉnh đề thi</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tende" className="text-sm font-medium">
                Tên đề
              </Label>
              <Input
                id="tende"
                value={tempSettings.tende}
                onChange={(e) =>
                  setTempSettings({ ...tempSettings, tende: e.target.value })
                }
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="made" className="text-sm font-medium">
                Mã đề
              </Label>
              <Input
                id="made"
                value={tempSettings.made}
                onChange={(e) =>
                  setTempSettings({ ...tempSettings, made: e.target.value })
                }
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="thoigian" className="text-sm font-medium">
                Thời gian (phút)
              </Label>
              <Input
                id="thoigian"
                type="number"
                value={tempSettings.thoigian}
                onChange={(e) =>
                  setTempSettings({
                    ...tempSettings,
                    thoigian: Number(e.target.value) || 0,
                  })
                }
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowSettings(false)}>
              Huỷ
            </Button>
            <Button onClick={saveSettings}>Lưu thay đổi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
