import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot,  
  setDoc, 
  updateDoc,
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  CheckCircle2, 
  Search,
  Zap,
  RefreshCw,
  Headphones,
  Sparkles,
  Volume2,
  PlayCircle,
  Loader2,
  Info,
  Eye,
  Ear
} from 'lucide-react';

// 注意：請確保這些全域變數在你的環境中已定義，或直接填入你的 Firebase 配置
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'toeic-1000-ai-v5';
const apiKey = "YOUR_GEMINI_API_KEY"; // 請填入你的 Gemini API Key

export default function App() {
  const [user, setUser] = useState(null);
  const [vocabulary, setVocabulary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentlySpeaking, setCurrentlySpeaking] = useState(null); 
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState(null);
  const [filterType, setFilterType] = useState('All'); 
  const [filterStatus, setFilterStatus] = useState('All');

  // --- Auth & Data Fetching ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error(e); }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const vocabRef = collection(db, 'artifacts', appId, 'users', user.uid, 'my_vocab');
    return onSnapshot(vocabRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVocabulary(data.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
      setLoading(false);
    }, (error) => console.error("Firestore error:", error));
  }, [user]);

  // --- TTS 音訊邏輯 ---
  const fetchAudioWithRetry = async (text, retries = 5, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: text }] }],
            generationConfig: { 
              responseModalities: ["AUDIO"],
              speechConfig: { 
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } 
              } 
            }
          })
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        const pcmBase64 = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (pcmBase64) return pcmBase64;
        throw new Error("No audio data");
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  };

  const pcmToWav = (base64Pcm, sampleRate) => {
    const binaryString = window.atob(base64Pcm);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    const wavBuffer = new ArrayBuffer(44 + bytes.length);
    const view = new DataView(wavBuffer);
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + bytes.length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, bytes.length, true);
    new Uint8Array(wavBuffer, 44).set(bytes);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  };

  const speak = async (text, id) => {
    if (currentlySpeaking) return;
    setCurrentlySpeaking(id);
    try {
      const pcmBase64 = await fetchAudioWithRetry(text);
      const audioBlob = pcmToWav(pcmBase64, 24000);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setCurrentlySpeaking(null);
        URL.revokeObjectURL(audioUrl);
      };
      await audio.play();
    } catch (e) {
      setCurrentlySpeaking(null);
      setMessage("語音引擎繁忙");
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // --- AI 生成邏輯 ---
  const generateNewBatchWithAI = async () => {
    if (!user || isGenerating) return;
    setIsGenerating(true);
    setMessage("AI 正在分析單字...");
    const existingWords = vocabulary.map(v => v.word).join(', ');
    const systemPrompt = `你是一位專業的多益老師。請生成 10 個高品質的多益核心單字。JSON 陣列格式，欄位：word, ipa, pos, zh, en, sent, category, type(Reading/Listening/Both)。不要包含：${existingWords}。`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "生成 10 個核心單字" }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const newWords = JSON.parse(text);
      const userVocabRef = collection(db, 'artifacts', appId, 'users', user.uid, 'my_vocab');
      for (const item of newWords) {
        await setDoc(doc(userVocabRef, crypto.randomUUID()), { ...item, status: false, timestamp: Date.now() });
      }
      setMessage(`新增成功！`);
    } catch (err) { setMessage("生成失敗"); } finally {
      setIsGenerating(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const toggleMastery = async (item) => {
    if (!user) return;
    await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'my_vocab', item.id), { status: !item.status });
  };

  // --- Filter Logic ---
  const filteredItems = useMemo(() => {
    return vocabulary.filter(v => {
      const matchesSearch = v.word.toLowerCase().includes(searchTerm.toLowerCase()) || v.zh.includes(searchTerm);
      const matchesType = filterType === 'All' || v.type === filterType;
      const matchesStatus = filterStatus === 'All' ? true : (filterStatus === 'Mastered' ? v.status : !v.status);
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [vocabulary, searchTerm, filterType, filterStatus]);

  const stats = {
    total: vocabulary.length,
    mastered: vocabulary.filter(v => v.status).length,
    percent: vocabulary.length ? Math.round((vocabulary.filter(v => v.status).length / vocabulary.length) * 100) : 0
  };

  // --- UI Components ---
  const TypeBadge = ({ type }) => {
    const configs = {
      Reading: { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: <Eye className="w-3 h-3" />, label: '閱讀' },
      Listening: { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: <Ear className="w-3 h-3" />, label: '聽力' },
      Both: { color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', icon: <Zap className="w-3 h-3" />, label: '雙棲' }
    };
    const config = configs[type] || configs.Both;
    return (
      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${config.color}`}>
        {config.icon} {config.label}
      </div>
    );
  };

  if (loading) return (
    <div className="h-screen bg-[#07090F] flex flex-col items-center justify-center gap-6">
      <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
      <p className="text-indigo-400 font-bold tracking-[0.2em] text-[10px] uppercase">Booting Master System...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#07090F] text-slate-200 p-5 pb-20">
      {/* 這裡是你的 UI 內容，包含 Header, Search, Word Cards 等 (同你提供的 JSX) */}
      <div className="max-w-xl mx-auto pt-4 mb-8">
         <header className="flex justify-between items-end mb-8">
           <div className="flex items-center gap-4">
             <div className="bg-indigo-600 p-3 rounded-2xl shadow-xl rotate-3">
               <Headphones className="w-6 h-6 text-white" />
             </div>
             <div>
               <h1 className="text-2xl font-black text-white italic uppercase tracking-tighter">TOEIC <span className="text-indigo-500">Master</span></h1>
               <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mt-1">Active Learning Engine</p>
             </div>
           </div>
           <div className="bg-white/5 border border-white/5 px-4 py-2 rounded-xl text-right">
              <p className="text-xs font-black text-slate-500 uppercase mb-0.5">Mastery Rate</p>
              <p className="text-xl font-black text-indigo-400 leading-none">{stats.percent}%</p>
           </div>
         </header>

         <button onClick={generateNewBatchWithAI} disabled={isGenerating} className="w-full mb-8 relative group overflow-hidden rounded-3xl">
           <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-sky-600 opacity-90" />
           <div className="relative flex items-center justify-center gap-4 py-5 font-black text-sm tracking-widest uppercase text-white">
             {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 animate-bounce" />}
             {isGenerating ? "Analyzing..." : "獲取 AI 新單字"}
           </div>
         </button>

         {/* 搜尋與篩選 (同你原本的 JSX) */}
         <div className="space-y-4 mb-8">
            <div className="relative">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
              <input 
                type="text" 
                placeholder="搜尋單字..."
                className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-16 pr-6 font-bold focus:border-indigo-500 outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
         </div>

         {/* 單字卡片列表 */}
         <div className="space-y-6">
           {filteredItems.map(item => (
             <div key={item.id} className={`p-8 rounded-[2.5rem] border transition-all ${item.status ? 'bg-slate-900/30 opacity-60' : 'bg-slate-900/80 border-white/5'}`}>
               <div className="flex justify-between items-start mb-6">
                 <div>
                   <div className="flex items-center gap-3">
                     <h3 className="text-3xl font-black text-white">{item.word}</h3>
                     <button onClick={() => speak(item.word, `${item.id}-word`)} className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
                       <Volume2 className="w-5 h-5" />
                     </button>
                   </div>
                   <TypeBadge type={item.type} />
                 </div>
                 <button onClick={() => toggleMastery(item)} className={`p-4 rounded-2xl ${item.status ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-700'}`}>
                   <CheckCircle2 className="w-7 h-7" />
                 </button>
               </div>
               <p className="text-2xl font-black text-white mb-2">{item.zh}</p>
               <p className="text-sm text-slate-400 italic">"{item.sent}"</p>
             </div>
           ))}
         </div>
      </div>

      {message && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-8 py-3 rounded-full font-black text-xs shadow-2xl uppercase border border-white/20">
          {message}
        </div>
      )}
    </div>
  );
}
