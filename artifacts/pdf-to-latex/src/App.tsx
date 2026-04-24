import { useState, useRef, useCallback } from "react";
import { FileData, convertToLatex, listGeminiModels, assembleLatex } from "./lib/gemini";
import { LATEX_TEMPLATE } from "./lib/template";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card } from "./components/ui/card";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { useToast } from "./hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./components/ui/dialog";
import { Upload, Image as ImageIcon, FileText, Check, Settings, Copy, Save, KeyRound, Loader2, X, GripVertical, Moon, Sun, ChevronDown } from "lucide-react";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { useTheme } from "./hooks/use-theme";

function FileList({ files, setFiles }: { files: FileData[], setFiles: React.Dispatch<React.SetStateAction<FileData[]>> }) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleSort = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    let _files = [...files];
    const draggedItemContent = _files.splice(dragItem.current, 1)[0];
    _files.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setFiles(_files);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  return (
    <ScrollArea className="h-[250px] w-full rounded-md border p-4 bg-muted/30">
      <div className="flex flex-col gap-2">
        {files.map((file, index) => (
          <div
            key={`${file.file.name}-${index}`}
            draggable
            onDragStart={(e) => (dragItem.current = index)}
            onDragEnter={(e) => (dragOverItem.current = index)}
            onDragEnd={handleSort}
            onDragOver={(e) => e.preventDefault()}
            className="flex items-center gap-3 bg-background border rounded-lg p-2 shadow-sm cursor-grab hover:border-primary transition-colors"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="h-10 w-10 flex-shrink-0 bg-muted rounded overflow-hidden flex items-center justify-center">
              {file.file.type.startsWith('image/') ? (
                <img src={file.base64} alt="thumbnail" className="h-full w-full object-cover" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-sm font-medium truncate">{file.file.name}</span>
              <span className="text-xs text-muted-foreground">{(file.file.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeFile(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Home() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [checkingKey, setCheckingKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-pro");
  const [showModels, setShowModels] = useState(false);

  const [files, setFiles] = useState<FileData[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const [isConverting, setIsConverting] = useState(false);
  const [latexOutput, setLatexOutput] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem("exam_settings");
    return saved ? JSON.parse(saved) : { tende: "ĐỀ MINH HOẠ", made: "01", thoigian: 90 };
  });

  const [tempSettings, setTempSettings] = useState(settings);

  // File Upload Handlers
  const handleFiles = async (newFiles: FileList | File[]) => {
    const validFiles: FileData[] = [];
    let hasPdf = false;
    
    // Check existing files for PDF
    if (files.some(f => f.file.type === 'application/pdf')) {
      hasPdf = true;
    }

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (file.type === 'application/pdf') {
        if (files.length > 0 || newFiles.length > 1) {
          toast({ title: "Lưu ý", description: "Chỉ được tải lên 1 tệp PDF duy nhất. Đã thay thế các tệp cũ.", variant: "default" });
        }
        hasPdf = true;
        validFiles.length = 0; // Clear
      } else if (file.type.startsWith('image/')) {
        if (hasPdf) {
          toast({ title: "Lỗi", description: "Không thể trộn lẫn PDF và ảnh.", variant: "destructive" });
          continue;
        }
      } else {
        continue; // Unsupported file type
      }

      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      
      validFiles.push({ file, base64: base64.split(',')[1] }); // Store just the base64 part for API
    }

    if (hasPdf) {
      setFiles(validFiles.slice(0, 1));
    } else {
      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // API Key Check
  const checkApiKey = async () => {
    if (!apiKey) {
      toast({ title: "Lỗi", description: "Vui lòng nhập khóa API Gemini.", variant: "destructive" });
      return;
    }
    setCheckingKey(true);
    try {
      const availableModels = await listGeminiModels(apiKey);
      setModels(availableModels);
      if (!availableModels.includes(selectedModel) && availableModels.length > 0) {
        setSelectedModel(availableModels[0]);
      }
      localStorage.setItem("gemini_api_key", apiKey);
      setShowModels(true);
      toast({ title: "Thành công", description: "Khóa API hợp lệ.", variant: "default" });
    } catch (error: any) {
      toast({ title: "Không thể kết nối Gemini", description: error.message, variant: "destructive" });
      setShowModels(false);
    } finally {
      setCheckingKey(false);
    }
  };

  // Convert
  const doConvert = async () => {
    if (!apiKey) {
      toast({ title: "Lỗi", description: "Vui lòng nhập khóa API Gemini.", variant: "destructive" });
      return;
    }
    if (files.length === 0) {
      toast({ title: "Lỗi", description: "Vui lòng tải lên ít nhất một tệp.", variant: "destructive" });
      return;
    }

    setIsConverting(true);
    setLatexOutput("");
    try {
      const output = await convertToLatex(apiKey, selectedModel, files);
      if (!output || output.trim() === "") {
         throw new Error("Gemini không trả về kết quả hợp lệ. Hãy thử lại.");
      }
      const finalDoc = assembleLatex(LATEX_TEMPLATE, settings.tende, settings.made, settings.thoigian.toString(), output);
      setLatexOutput(finalDoc);
      toast({ title: "Thành công", description: "Đã chuyển đổi xong.", variant: "default" });
    } catch (error: any) {
      toast({ title: "Lỗi chuyển đổi", description: error.message, variant: "destructive" });
    } finally {
      setIsConverting(false);
    }
  };

  // Save settings
  const saveSettings = () => {
    setSettings(tempSettings);
    localStorage.setItem("exam_settings", JSON.stringify(tempSettings));
    setShowSettings(false);
  };

  // Actions
  const copyToClipboard = async () => {
    if (!latexOutput) return;
    try {
      await navigator.clipboard.writeText(latexOutput);
      toast({ title: "Thành công", description: "Đã sao chép mã LaTeX." });
    } catch (err) {
      toast({ title: "Lỗi", description: "Không thể sao chép.", variant: "destructive" });
    }
  };

  const downloadFile = async () => {
    if (!latexOutput) return;
    const filename = `${settings.tende.replace(/[^a-zA-Z0-9]/g, "_")}_${settings.made}.tex`;
    
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'LaTeX File',
            accept: {'text/plain': ['.tex']},
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(latexOutput);
        await writable.close();
      } else {
        const blob = new Blob([latexOutput], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast({ title: "Thành công", description: "Đã lưu tệp." });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast({ title: "Lỗi", description: "Không thể lưu tệp.", variant: "destructive" });
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
            <h1 className="text-xl font-semibold hidden md:block tracking-tight text-primary">Trình chuyển đổi PDF / Ảnh sang LaTeX</h1>
            <h1 className="text-xl font-semibold md:hidden tracking-tight text-primary">PDF → LaTeX</h1>
          </div>

          <div className="flex flex-1 md:flex-none items-center justify-end gap-2">
             <Button variant="ghost" size="icon" onClick={toggleTheme} className="hidden sm:flex shrink-0">
               {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
             </Button>

            {showModels && models.length > 0 && (
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-[140px] h-9 shrink-0">
                  <SelectValue placeholder="Chọn model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="relative flex-1 max-w-[300px]">
              <KeyRound className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input 
                type="password" 
                placeholder="Nhập khóa API từ aistudio..." 
                className="pl-9 h-9"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkApiKey()}
              />
            </div>
            <Button onClick={checkApiKey} disabled={checkingKey} size="sm" className="h-9 shrink-0">
              {checkingKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2 hidden sm:block" />}
              Kiểm tra
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 flex flex-col gap-6">
        
        {/* Three Columns */}
        <div className="flex flex-col md:flex-row gap-6">
          
          {/* Column 1: Upload */}
          <div className="flex-1 md:w-[40%] flex flex-col gap-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Tải lên tệp
            </h2>
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer ${isDragging ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <input 
                type="file" 
                id="file-upload" 
                multiple 
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp" 
                className="hidden" 
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-primary/10 rounded-full text-primary">
                  <ImageIcon className="h-8 w-8" />
                </div>
              </div>
              <p className="text-base font-medium mb-1">Kéo thả tệp vào đây, hoặc click để chọn</p>
              <p className="text-sm text-muted-foreground">Hỗ trợ 1 tệp PDF hoặc nhiều tệp ảnh (PNG, JPG, WEBP)</p>
            </div>

            {files.length > 0 && <FileList files={files} setFiles={setFiles} />}
          </div>

          {/* Column 2: Convert Button */}
          <div className="flex md:w-[20%] items-center justify-center py-6 md:py-0">
            <Button 
              size="lg" 
              className="w-full h-16 text-lg rounded-2xl shadow-lg hover:shadow-xl transition-all"
              onClick={doConvert}
              disabled={isConverting || files.length === 0 || !apiKey}
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
          </div>

          {/* Column 3: Settings */}
          <div className="flex-1 md:w-[40%] flex flex-col gap-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Thiết lập đề thi
            </h2>
            <Card className="p-6 bg-muted/30 border-dashed border-2 flex flex-col items-center justify-center min-h-[200px] text-center">
              <p className="text-sm text-muted-foreground mb-4">Tên đề: {settings.tende} • Mã đề: {settings.made} • {settings.thoigian} phút</p>
              <Button variant="secondary" onClick={() => { setTempSettings(settings); setShowSettings(true); }}>
                Tinh chỉnh đề
              </Button>
            </Card>
          </div>

        </div>

        {/* Info Strip */}
        <div className="flex flex-wrap gap-3 py-2 border-y border-border/50 bg-muted/10 rounded-lg px-4 items-center justify-center">
          <Badge variant="outline" className="text-sm py-1 px-3 bg-background font-medium">Tên đề: {settings.tende}</Badge>
          <Badge variant="outline" className="text-sm py-1 px-3 bg-background font-medium">Thời gian: {settings.thoigian} phút</Badge>
          <Badge variant="outline" className="text-sm py-1 px-3 bg-background font-medium">Mã đề: {settings.made}</Badge>
        </div>

        {/* Output Area */}
        <div className="flex flex-col gap-4 flex-1 mt-4 min-h-[400px]">
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
            <Button variant="outline" size="lg" onClick={copyToClipboard} disabled={!latexOutput}>
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
              <Label htmlFor="tende" className="text-sm font-medium">Tên đề</Label>
              <Input 
                id="tende" 
                value={tempSettings.tende} 
                onChange={(e) => setTempSettings({...tempSettings, tende: e.target.value})} 
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="made" className="text-sm font-medium">Mã đề</Label>
              <Input 
                id="made" 
                value={tempSettings.made} 
                onChange={(e) => setTempSettings({...tempSettings, made: e.target.value})} 
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="thoigian" className="text-sm font-medium">Thời gian (phút)</Label>
              <Input 
                id="thoigian" 
                type="number" 
                value={tempSettings.thoigian} 
                onChange={(e) => setTempSettings({...tempSettings, thoigian: Number(e.target.value) || 0})} 
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowSettings(false)}>Huỷ</Button>
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

