import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Clock,
    Cpu,
    Download,
    ExternalLink,
    HardDrive,
    Play,
    Plus,
    Server,
    Settings,
    Square,
    Thermometer,
    Zap
} from 'lucide-react';
import { useState } from 'react';

function GPUCard({ gpu, isPlaceholder }) {
  if (isPlaceholder) {
    return (
      <div className="bg-[#252526] border border-dashed border-[#3c3c3c] rounded-lg p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
        <div className="w-16 h-16 rounded-full bg-[#2d2d2d] flex items-center justify-center mb-4">
          <Plus className="w-8 h-8 text-[#6e6e6e]" />
        </div>
        <h3 className="text-sm font-medium text-[#858585] mb-1">No GPU Detected</h3>
        <p className="text-xs text-[#6e6e6e] mb-4">Connect a GPU to enable local AI inference</p>
        <a 
          href="https://ollama.ai" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-[#0078d4] text-white hover:bg-[#1e8ad4] transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Setup Guide
        </a>
      </div>
    );
  }

  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#cccccc]">{gpu.name}</h3>
            <p className="text-xs text-[#858585]">{gpu.vram} VRAM</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 ${gpu.active ? 'text-[#4ec9b0]' : 'text-[#858585]'}`}>
          {gpu.active ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-xs">{gpu.active ? 'Active' : 'Idle'}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#2d2d2d] rounded p-2">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-3 h-3 text-[#858585]" />
            <p className="text-[10px] text-[#6e6e6e]">Utilization</p>
          </div>
          <p className="text-sm text-[#cccccc]">{gpu.utilization}%</p>
        </div>
        <div className="bg-[#2d2d2d] rounded p-2">
          <div className="flex items-center gap-1 mb-1">
            <Thermometer className="w-3 h-3 text-[#858585]" />
            <p className="text-[10px] text-[#6e6e6e]">Temperature</p>
          </div>
          <p className="text-sm text-[#cccccc]">{gpu.temp}°C</p>
        </div>
        <div className="bg-[#2d2d2d] rounded p-2">
          <div className="flex items-center gap-1 mb-1">
            <Zap className="w-3 h-3 text-[#858585]" />
            <p className="text-[10px] text-[#6e6e6e]">Power</p>
          </div>
          <p className="text-sm text-[#cccccc]">{gpu.power}W</p>
        </div>
      </div>

      <div className="h-2 bg-[#2d2d2d] rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-[#4ec9b0] to-[#00bcf2] transition-all duration-500"
          style={{ width: `${gpu.vramUsed}%` }}
        />
      </div>
      <p className="text-[10px] text-[#6e6e6e] mt-1">VRAM: {gpu.vramUsed}% used</p>
    </div>
  );
}

function ModelCard({ model, onLoad, onUnload, isLoading }) {
  return (
    <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium text-[#cccccc]">{model.name}</h3>
          <p className="text-xs text-[#858585]">{model.size} • {model.quantization}</p>
        </div>
        {model.loaded && (
          <span className="px-2 py-0.5 text-[10px] rounded bg-[#4ec9b0]/20 text-[#4ec9b0]">LOADED</span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-[#6e6e6e] mb-3">
        <Clock className="w-3 h-3" />
        <span>{model.context}k context</span>
        <span>•</span>
        <span>{model.speed} tok/s</span>
      </div>

      <div className="flex gap-2">
        {model.loaded ? (
          <button 
            onClick={() => onUnload(model)}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-[#f14c4c] text-white hover:bg-[#d93e3e] transition-colors"
          >
            <Square className="w-3 h-3" />
            Unload
          </button>
        ) : (
          <button 
            onClick={() => onLoad(model)}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-[#4ec9b0] text-black hover:bg-[#3da88a] transition-colors disabled:opacity-50"
          >
            <Play className="w-3 h-3" />
            {isLoading ? 'Loading...' : 'Load'}
          </button>
        )}
        <button className="px-2 py-1.5 rounded text-xs bg-[#2d2d2d] text-[#cccccc] hover:bg-[#3c3c3c] transition-colors">
          <Settings className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function LocalAI() {
  const [gpus, setGpus] = useState([]);
  const [models, setModels] = useState([
    { name: 'Llama 3.1 8B', size: '4.7GB', quantization: 'Q4_K_M', context: 8, speed: '~45', loaded: false },
    { name: 'Mistral 7B', size: '4.1GB', quantization: 'Q4_K_M', context: 32, speed: '~55', loaded: false },
    { name: 'DeepSeek Coder 6.7B', size: '3.8GB', quantization: 'Q4_K_M', context: 16, speed: '~60', loaded: false },
    { name: 'Phi-3 Mini', size: '2.2GB', quantization: 'Q4_K_M', context: 4, speed: '~80', loaded: false },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState('not_installed');

  // Check for Ollama installation
  const checkOllama = async () => {
    try {
      const res = await fetch('/api/dashboard/local-ai/status');
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus(data.status);
        if (data.gpus) setGpus(data.gpus);
        if (data.models) setModels(data.models);
      }
    } catch {
      setOllamaStatus('not_installed');
    }
  };

  const handleLoadModel = async (model) => {
    setIsLoading(true);
    // API call to load model
    setTimeout(() => {
      setModels(prev => prev.map(m => m.name === model.name ? { ...m, loaded: true } : m));
      setIsLoading(false);
    }, 2000);
  };

  const handleUnloadModel = async (model) => {
    setModels(prev => prev.map(m => m.name === model.name ? { ...m, loaded: false } : m));
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#cccccc]">Local AI</h1>
          <p className="text-sm text-[#858585]">GPU-accelerated local model inference</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs ${
            ollamaStatus === 'running' ? 'bg-[#4ec9b0]/20 text-[#4ec9b0]' :
            ollamaStatus === 'installed' ? 'bg-[#dcdcaa]/20 text-[#dcdcaa]' :
            'bg-[#f14c4c]/20 text-[#f14c4c]'
          }`}>
            {ollamaStatus === 'running' ? 'Ollama Running' :
             ollamaStatus === 'installed' ? 'Ollama Stopped' :
             'Ollama Not Installed'}
          </span>
        </div>
      </div>

      {/* Coming Soon Banner */}
      <div className="mb-6 p-4 rounded-lg bg-gradient-to-r from-[#0078d4]/20 to-[#00bcf2]/20 border border-[#0078d4]/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0078d4] flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-[#cccccc]">GPU Inference Coming Soon</h3>
            <p className="text-xs text-[#858585]">
              This feature will be fully enabled once you connect GPUs. 
              Currently using external providers as fallback.
            </p>
          </div>
          <a 
            href="https://ollama.ai/download" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded text-xs bg-[#0078d4] text-white hover:bg-[#1e8ad4] transition-colors"
          >
            <Download className="w-3 h-3" />
            Install Ollama
          </a>
        </div>
      </div>

      {/* GPU Section */}
      <h2 className="text-sm font-medium text-[#cccccc] mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4" />
        GPU Devices
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {gpus.length > 0 ? (
          gpus.map((gpu, i) => <GPUCard key={i} gpu={gpu} />)
        ) : (
          <GPUCard isPlaceholder />
        )}
      </div>

      {/* Models Section */}
      <h2 className="text-sm font-medium text-[#cccccc] mb-4 flex items-center gap-2">
        <Server className="w-4 h-4" />
        Available Models
        <span className="text-xs text-[#6e6e6e]">(requires Ollama)</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {models.map((model, i) => (
          <ModelCard 
            key={i} 
            model={model} 
            onLoad={handleLoadModel}
            onUnload={handleUnloadModel}
            isLoading={isLoading}
          />
        ))}
      </div>

      {/* Configuration */}
      <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4">
        <h2 className="text-sm font-medium text-[#cccccc] mb-4">Inference Configuration</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-[10px] text-[#6e6e6e] uppercase tracking-wide">Fallback Strategy</label>
            <select className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc]">
              <option>Local → External</option>
              <option>External Only</option>
              <option>Local Only</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#6e6e6e] uppercase tracking-wide">Max Context</label>
            <select className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc]">
              <option>4096 tokens</option>
              <option>8192 tokens</option>
              <option>16384 tokens</option>
              <option>32768 tokens</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#6e6e6e] uppercase tracking-wide">GPU Layers</label>
            <input 
              type="number" 
              defaultValue={35}
              className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc]"
            />
          </div>
          <div>
            <label className="text-[10px] text-[#6e6e6e] uppercase tracking-wide">Threads</label>
            <input 
              type="number" 
              defaultValue={8}
              className="w-full mt-1 px-3 py-2 rounded bg-[#2d2d2d] border border-[#3c3c3c] text-sm text-[#cccccc]"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="px-4 py-2 rounded text-xs bg-[#0078d4] text-white hover:bg-[#1e8ad4] transition-colors">
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
