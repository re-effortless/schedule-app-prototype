import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Calendar, Clock, Users, Plus, Trash2, Check, X, 
  ChevronDown, ChevronUp, Copy, ArrowRight, Settings, 
  AlertCircle, Info, Edit3, Share2, ChevronLeft, ChevronRight,
  MessageCircle, CornerDownRight
} from 'lucide-react';
import { 
  format, addDays, eachDayOfInterval, parseISO, 
  isSameDay, getDay, startOfDay, isBefore, isAfter,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth
} from 'date-fns';
import { ja } from 'date-fns/locale';

// --- 型定義 (JSDoc等) ---

/*
Type Definitions:
EventData: { 
  id, title, description, 
  candidateDates: string[], // YYYY-MM-DD形式のリスト (優先)
  period: { start, end }, // 互換性・範囲用
  participants: Participant[] 
}
Participant: { id, name, mode: 'whitelist' | 'blacklist', availabilities: Availability[] }
Availability: { dateStr: string, timeRanges: { start: string, end: string }[], memo: string }
*/

// --- 定数・ユーティリティ ---

const SLOT_MINUTES = 15; // 集計の粒度（分）

// 時間文字列 (HH:mm) を分 (0-1439) に変換
// 空文字の場合は、isStart=trueなら0(00:00), falseなら1440(24:00)として扱う
const timeToMinutes = (timeStr, isStart = true) => {
  if (timeStr === '' || timeStr === null || timeStr === undefined) {
    return isStart ? 0 : 24 * 60;
  }
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

// 分 (0-1439) を時間文字列 (HH:mm) に変換
const minutesToTime = (totalMinutes) => {
  if (totalMinutes >= 24 * 60) return "24:00";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// 時間帯の反転ロジック (入力モード切替用)
const invertTimeRanges = (ranges) => {
  if (!ranges || ranges.length === 0) {
    return [{ start: '', end: '' }];
  }

  const sorted = ranges.map(r => ({
    start: timeToMinutes(r.start, true),
    end: timeToMinutes(r.end, false)
  })).sort((a, b) => a.start - b.start);

  const merged = [];
  if (sorted.length > 0) {
    let curr = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= curr.end) {
        curr.end = Math.max(curr.end, sorted[i].end);
      } else {
        merged.push(curr);
        curr = sorted[i];
      }
    }
    merged.push(curr);
  }

  const inverted = [];
  let currentHead = 0;
  
  merged.forEach(r => {
    if (r.start > currentHead) {
      inverted.push({ start: currentHead, end: r.start });
    }
    currentHead = Math.max(currentHead, r.end);
  });
  
  if (currentHead < 24 * 60) {
    inverted.push({ start: currentHead, end: 24 * 60 });
  }

  return inverted.map(r => ({
    start: r.start === 0 ? '' : minutesToTime(r.start),
    end: r.end === 24 * 60 ? '' : minutesToTime(r.end)
  }));
};

// 日付リストをソートして返す
const sortDates = (dateStrs) => {
  return [...dateStrs].sort((a, b) => a.localeCompare(b));
};

// ダミーデータ生成
const generateDummyData = () => {
  const today = startOfDay(new Date());
  // 飛び飛びの日程を作成
  const d1 = format(addDays(today, 1), 'yyyy-MM-dd');
  const d2 = format(addDays(today, 3), 'yyyy-MM-dd');
  const d3 = format(addDays(today, 7), 'yyyy-MM-dd');
  const candidateDates = [d1, d2, d3];
  
  const eventId = Math.random().toString(36).substring(7);
  
  return {
    id: eventId,
    title: "プロジェクト定例 & 懇親会",
    description: "次回の定例と、その後の懇親会の日程調整です。\n離れた日程ですが候補を挙げました。",
    candidateDates: candidateDates,
    period: {
      start: parseISO(d1),
      end: parseISO(d3),
    },
    participants: [
      {
        id: 'p1',
        name: '田中 (幹事)',
        mode: 'whitelist',
        availabilities: [
          { dateStr: d1, timeRanges: [{ start: '10:00', end: '18:00' }], memo: '' },
          { dateStr: d2, timeRanges: [{ start: '13:00', end: '' }], memo: '午後は空いてます' },
        ]
      },
      {
        id: 'p2',
        name: '鈴木',
        mode: 'blacklist',
        availabilities: [
          { dateStr: d1, timeRanges: [{ start: '09:00', end: '12:00' }], memo: '午前NG' },
        ]
      },
      {
        id: 'p3',
        name: '佐藤',
        mode: 'whitelist',
        availabilities: [
          { dateStr: d1, timeRanges: [{ start: '15:00', end: '' }], memo: '15時以降なら' },
          { dateStr: d2, timeRanges: [{ start: '', end: '12:00' }], memo: '午前中のみ' },
          { dateStr: d3, timeRanges: [{ start: '', end: '' }], memo: '終日OK' },
        ]
      }
    ]
  };
};

// --- コンポーネント ---

// カスタム時間選択コンポーネント (5分刻みプルダウン)
const TimeSelector = ({ value, onChange, className, placeholder = "--" }) => {
  const [h, m] = value ? value.split(':') : ['', ''];
  
  const hours = [...Array(24).keys()].map(i => String(i).padStart(2, '0'));
  const minutes = [...Array(12).keys()].map(i => String(i * 5).padStart(2, '0')); // 00, 05, 10...

  const handleHourChange = (e) => {
    const newH = e.target.value;
    if (!newH) {
      onChange(''); // 時をクリアしたら全体もクリア
      return;
    }
    // 時を選択した時点で分が空なら00にする
    const newM = m || '00';
    onChange(`${newH}:${newM}`);
  };

  const handleMinuteChange = (e) => {
    const newM = e.target.value;
    if (!h) return; // 時が未選択なら操作無効
    onChange(`${h}:${newM}`);
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative">
        <select 
          value={h} 
          onChange={handleHourChange}
          className={`bg-transparent appearance-none outline-none text-center font-mono cursor-pointer pr-3 py-1 hover:text-indigo-600 transition-colors ${!h ? 'text-gray-400' : 'text-gray-800'}`}
        >
          <option value="">{placeholder}</option>
          {hours.map(hour => <option key={hour} value={hour}>{hour}</option>)}
        </select>
        {/* カスタム矢印などを配置したい場合はここに */}
      </div>
      <span className="text-gray-400 -mx-1">:</span>
      <div className="relative">
        <select 
          value={m} 
          onChange={handleMinuteChange}
          className={`bg-transparent appearance-none outline-none text-center font-mono cursor-pointer pl-3 py-1 hover:text-indigo-600 transition-colors ${!h ? 'text-gray-300 cursor-not-allowed' : 'text-gray-800'}`}
          disabled={!h}
        >
          {!h && <option value="">--</option>}
          {h && minutes.map(minute => <option key={minute} value={minute}>{minute}</option>)}
        </select>
      </div>
    </div>
  );
};


// カレンダー日付選択コンポーネント (ドラッグ対応版)
const DateSelector = ({ selectedDates, onChange }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(null); // 'add' | 'remove'

  // グローバルイベントリスナー（ドラッグ終了検知）
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const toggleDate = (dateStr, mode) => {
    const isSelected = selectedDates.includes(dateStr);
    if (mode === 'add' && !isSelected) {
      onChange([...selectedDates, dateStr]);
    } else if (mode === 'remove' && isSelected) {
      onChange(selectedDates.filter(d => d !== dateStr));
    }
  };

  const handleMouseDown = (dateStr) => {
    setIsDragging(true);
    const isSelected = selectedDates.includes(dateStr);
    const mode = isSelected ? 'remove' : 'add';
    setDragMode(mode);
    toggleDate(dateStr, mode);
  };

  const handleMouseEnter = (dateStr) => {
    if (isDragging && dragMode) {
      toggleDate(dateStr, dragMode);
    }
  };

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 select-none">
      <div className="flex justify-between items-center mb-4">
        <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-200 rounded"><ChevronLeft /></button>
        <span className="font-bold text-lg">{format(currentMonth, 'yyyy年 M月')}</span>
        <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-200 rounded"><ChevronRight /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-2">
        {weekDays.map((d, i) => (
          <div key={i} className={`text-xs font-bold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isSelected = selectedDates.includes(dateStr);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          
          return (
            <div
              key={dateStr}
              onMouseDown={() => handleMouseDown(dateStr)}
              onMouseEnter={() => handleMouseEnter(dateStr)}
              className={`
                aspect-square rounded-lg flex flex-col items-center justify-center text-sm relative transition-all cursor-pointer
                ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                ${isSelected ? 'bg-indigo-600 text-white shadow-md font-bold' : 'hover:bg-white hover:shadow-sm'}
                ${isToday && !isSelected ? 'border border-indigo-300' : ''}
              `}
            >
              <span>{format(day, 'd')}</span>
              {isSelected && <Check className="w-3 h-3 absolute bottom-1" />}
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-right text-sm text-gray-500">
        <span className="text-xs text-gray-400 mr-2">ドラッグで連続選択可</span>
        選択中の日程: <span className="font-bold text-indigo-600">{selectedDates.length}</span> 日
      </div>
    </div>
  );
};

// 1. イベント作成画面
const CreateEventScreen = ({ onCreate }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDates, setSelectedDates] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedDates.length === 0) {
      alert('日程を少なくとも1つ選択してください');
      return;
    }

    const sorted = sortDates(selectedDates);
    const start = parseISO(sorted[0]);
    const end = parseISO(sorted[sorted.length - 1]);

    onCreate({
      title,
      description,
      candidateDates: sorted,
      period: { start, end },
      participants: []
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white shadow-xl rounded-xl my-8">
      <h1 className="text-2xl font-bold text-indigo-700 mb-6 flex items-center gap-2">
        <Calendar className="w-8 h-8" />
        イベントを作成
      </h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">イベント名</label>
          <input
            type="text"
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="例: チームランチ会"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">概要</label>
          <textarea
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-24"
            placeholder="イベントの詳細や補足事項を入力..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">候補日を選択（複数選択可）</label>
          <DateSelector selectedDates={selectedDates} onChange={setSelectedDates} />
        </div>

        <button
          type="submit"
          className="w-full py-4 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-lg"
        >
          <Check className="w-5 h-5" />
          調整表を作成する
        </button>
      </form>
    </div>
  );
};

// 2. 一括入力モーダル
const BulkInputModal = ({ isOpen, onClose, onApply }) => {
  const [selectedDays, setSelectedDays] = useState([1, 2, 3, 4, 5]); // 月〜金
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  if (!isOpen) return null;

  const days = [
    { val: 1, label: '月' }, { val: 2, label: '火' }, { val: 3, label: '水' },
    { val: 4, label: '木' }, { val: 5, label: '金' }, { val: 6, label: '土' }, { val: 0, label: '日' }
  ];

  const toggleDay = (val) => {
    setSelectedDays(prev => prev.includes(val) ? prev.filter(d => d !== val) : [...prev, val]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Copy className="w-5 h-5 text-indigo-600" /> 一括入力
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">曜日を選択</label>
            <div className="flex gap-2 flex-wrap">
              {days.map(d => (
                <button
                  key={d.val}
                  onClick={() => toggleDay(d.val)}
                  className={`w-10 h-10 rounded-full font-bold text-sm transition-colors ${
                    selectedDays.includes(d.val)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">開始時間</label>
              <div className="p-2 border rounded bg-white">
                <TimeSelector 
                  value={startTime} 
                  onChange={setStartTime} 
                  className="w-full"
                  placeholder="--"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">終了時間</label>
              <div className="p-2 border rounded bg-white">
                <TimeSelector 
                  value={endTime} 
                  onChange={setEndTime} 
                  className="w-full"
                  placeholder="--"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
            ※ 時間未入力の場合は、それぞれ「00:00」「24:00」として扱われます。
          </p>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">キャンセル</button>
          <button
            onClick={() => onApply(selectedDays, startTime, endTime)}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-bold"
          >
            適用する
          </button>
        </div>
      </div>
    </div>
  );
};

// 3. 予定入力フォーム (ユーザーごと)
const InputForm = ({ eventData, onSave, onCancel, initialData }) => {
  const [name, setName] = useState(initialData?.name || '');
  const [mode, setMode] = useState(initialData?.mode || 'whitelist');
  const [availabilities, setAvailabilities] = useState(initialData?.availabilities || []);
  const [isBulkModalOpen, setBulkModalOpen] = useState(false);

  const targetDates = useMemo(() => {
    if (eventData.candidateDates && eventData.candidateDates.length > 0) {
      return eventData.candidateDates.map(d => parseISO(d));
    }
    return eachDayOfInterval(eventData.period);
  }, [eventData]);

  // モード変更時のハンドラ（自動変換ロジック）
  const handleModeChange = (newMode) => {
    const hasInput = availabilities.some(d => d.timeRanges.length > 0);

    if (hasInput) {
      const confirmMsg = `入力モードを「${newMode === 'whitelist' ? '参加可' : '参加不可'}」に変更します。\n\n現在入力されている日時の「逆」を選択状態に変換しますか？\n（キャンセルを押すと、入力内容はそのままモードだけ変更されます）`;
      
      if (window.confirm(confirmMsg)) {
        // 変更点: availabilitiesだけでなく、targetDates(全候補日)をベースに変換データを生成
        // これにより、未入力の日付も「反転」処理の対象となり、自動的に「終日指定」等が追加される
        const converted = targetDates.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const existing = availabilities.find(a => a.dateStr === dateStr);
          const ranges = existing ? existing.timeRanges : [];
          
          return {
            dateStr,
            timeRanges: invertTimeRanges(ranges), // 空配列なら終日指定が返る
            memo: existing ? existing.memo : ''
          };
        });
        
        setAvailabilities(converted);
        setMode(newMode);
      } else {
        // キャンセル時は何もしない（モードも変更しない）
      }
    } else {
      setMode(newMode);
    }
  };

  const getDayAvailability = (dateStr) => {
    return availabilities.find(a => a.dateStr === dateStr) || { dateStr, timeRanges: [], memo: '' };
  };

  const updateDayData = (dateStr, updates) => {
    setAvailabilities(prev => {
      const existing = prev.find(a => a.dateStr === dateStr);
      if (existing) {
        return prev.map(a => a.dateStr === dateStr ? { ...a, ...updates } : a);
      } else {
        return [...prev, { dateStr, timeRanges: [], memo: '', ...updates }];
      }
    });
  };

  const addTimeRange = (dateStr) => {
    const current = getDayAvailability(dateStr);
    const newRanges = [...current.timeRanges, { start: '', end: '' }];
    updateDayData(dateStr, { timeRanges: newRanges });
  };

  const removeTimeRange = (dateStr, index) => {
    const current = getDayAvailability(dateStr);
    const newRanges = current.timeRanges.filter((_, i) => i !== index);
    updateDayData(dateStr, { timeRanges: newRanges });
  };

  const updateTimeRange = (dateStr, index, field, value) => {
    const current = getDayAvailability(dateStr);
    const newRanges = [...current.timeRanges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    updateDayData(dateStr, { timeRanges: newRanges });
  };

  const handleBulkApply = (selectedDaysOfWeek, start, end) => {
    const newAvailabilities = [...availabilities];
    targetDates.forEach(day => {
      const dayOfWeek = getDay(day);
      if (selectedDaysOfWeek.includes(dayOfWeek)) {
        const dateStr = format(day, 'yyyy-MM-dd');
        let target = newAvailabilities.find(a => a.dateStr === dateStr);
        if (!target) {
          target = { dateStr, timeRanges: [], memo: '' };
          newAvailabilities.push(target);
        }
        target.timeRanges.push({ start, end });
      }
    });
    setAvailabilities(newAvailabilities);
    setBulkModalOpen(false);
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('名前を入力してください');
      return;
    }
    onSave({
      id: initialData?.id || Math.random().toString(36).substring(7),
      name,
      mode,
      availabilities
    });
  };

  const getTimeRangeLabel = (start, end) => {
    if (!start && !end) return "終日 (00:00 - 24:00)";
    if (!start) return `〜 ${end} まで`;
    if (!end) return `${start} 以降 〜`;
    return "";
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <div className="p-4 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="mb-4">
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">あなたの名前</label>
          <input
            type="text"
            placeholder="名前を入力"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full text-lg font-bold p-2 border-b-2 border-indigo-200 focus:border-indigo-600 focus:outline-none bg-transparent"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex bg-gray-200 rounded-lg p-1 text-xs sm:text-sm font-medium">
            <button
              onClick={() => handleModeChange('whitelist')}
              className={`px-3 py-2 rounded-md flex items-center gap-1 transition-all ${mode === 'whitelist' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
            >
              <Check className="w-4 h-4" /> 参加可を入力
            </button>
            <button
              onClick={() => handleModeChange('blacklist')}
              className={`px-3 py-2 rounded-md flex items-center gap-1 transition-all ${mode === 'blacklist' ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-500'}`}
            >
              <X className="w-4 h-4" /> 参加不可を入力
            </button>
          </div>
          
          <button 
            onClick={() => setBulkModalOpen(true)}
            className="text-indigo-600 text-sm font-bold flex items-center gap-1 hover:bg-indigo-50 px-2 py-1 rounded"
          >
            <Copy className="w-4 h-4" /> 一括入力
          </button>
        </div>
        
        {mode === 'blacklist' && (
          <div className="mt-2 text-xs text-rose-600 flex items-center gap-1 bg-rose-50 p-2 rounded">
            <AlertCircle className="w-4 h-4" />
            入力した日時が「NG」として扱われます。何も入力しない日時は「参加可能」となります。
          </div>
        )}
      </div>

      <div className="p-2 sm:p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {targetDates.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const data = getDayAvailability(dateStr);
          const isWeekend = getDay(day) === 0 || getDay(day) === 6;
          
          return (
            <div key={dateStr} className={`border rounded-lg p-3 ${isWeekend ? 'bg-gray-50' : 'bg-white'}`}>
              <div className="flex justify-between items-center mb-2">
                <div className="font-bold text-gray-700 flex items-center gap-2">
                  {format(day, 'MM/dd (E)', { locale: ja })}
                </div>
                <button 
                  onClick={() => addTimeRange(dateStr)}
                  className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium px-3 py-1.5 rounded-full flex items-center gap-1 border border-indigo-100"
                >
                  <Plus className="w-3 h-3" /> 時間を追加
                </button>
              </div>

              <div className="space-y-2">
                {data.timeRanges.length === 0 && (
                  <p className="text-xs text-gray-400 py-1 pl-1">
                    {mode === 'whitelist' ? '指定なし (不可)' : '指定なし (終日可)'}
                  </p>
                )}
                {data.timeRanges.map((range, idx) => {
                    const statusLabel = getTimeRangeLabel(range.start, range.end);
                    return (
                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 p-2 rounded border border-dashed border-gray-300 bg-gray-50/50">
                            <div className={`flex items-center gap-1 flex-1 p-1 rounded border bg-white ${mode === 'whitelist' ? 'border-indigo-200' : 'border-rose-200'}`}>
                            <Clock className={`w-4 h-4 ${mode === 'whitelist' ? 'text-indigo-400' : 'text-rose-400'}`} />
                            
                            {/* 5分刻みのセレクトボックスUIに変更 */}
                            <TimeSelector 
                              value={range.start} 
                              onChange={(val) => updateTimeRange(dateStr, idx, 'start', val)}
                              className="flex-1"
                              placeholder="--"
                            />
                            
                            <span className="text-gray-400 px-1">〜</span>
                            
                            <TimeSelector 
                              value={range.end} 
                              onChange={(val) => updateTimeRange(dateStr, idx, 'end', val)}
                              className="flex-1"
                              placeholder="--"
                            />

                            </div>
                            
                            <div className="flex justify-between items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs font-medium text-gray-500 min-w-[80px]">
                                    {statusLabel}
                                </span>
                                <button 
                                    onClick={() => removeTimeRange(dateStr, idx)}
                                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
                
                <input
                  type="text"
                  placeholder="メモ (例: 遅れるかも)"
                  value={data.memo}
                  onChange={(e) => updateDayData(dateStr, { memo: e.target.value })}
                  className="w-full text-xs border-b border-dashed border-gray-300 focus:border-indigo-400 outline-none py-1 bg-transparent placeholder-gray-400"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t bg-white flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 font-medium">
          キャンセル
        </button>
        <button 
          onClick={handleSave}
          className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-bold shadow-md hover:bg-indigo-700"
        >
          保存する
        </button>
      </div>

      <BulkInputModal 
        isOpen={isBulkModalOpen} 
        onClose={() => setBulkModalOpen(false)} 
        onApply={handleBulkApply} 
      />
    </div>
  );
};

// 4. 集計結果リスト
const ResultList = ({ event }) => {
  const { participants, period, candidateDates } = event;
  const [openMemoIndices, setOpenMemoIndices] = useState([]); // メモを展開している行のインデックスリスト

  const toggleMemo = (index) => {
    setOpenMemoIndices(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const aggregatedSlots = useMemo(() => {
    if (participants.length === 0) return [];

    let days = [];
    if (candidateDates && candidateDates.length > 0) {
      days = candidateDates.map(d => parseISO(d));
    } else {
      days = eachDayOfInterval(period);
    }
    
    const allSlots = [];

    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      
      for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
        const timeStart = m;
        const timeEnd = m + SLOT_MINUTES;
        
        const availableParticipants = participants.filter(p => {
          const pData = p.availabilities.find(a => a.dateStr === dateStr);
          let isAvailable = false;
          if (p.mode === 'whitelist') {
            if (pData && pData.timeRanges.length > 0) {
              isAvailable = pData.timeRanges.some(r => {
                const rStart = timeToMinutes(r.start, true);
                const rEnd = timeToMinutes(r.end, false);
                return (Math.max(rStart, timeStart) < Math.min(rEnd, timeEnd));
              });
            }
          } else {
            isAvailable = true;
            if (pData && pData.timeRanges.length > 0) {
              const isBlocked = pData.timeRanges.some(r => {
                const rStart = timeToMinutes(r.start, true);
                const rEnd = timeToMinutes(r.end, false);
                return (Math.max(rStart, timeStart) < Math.min(rEnd, timeEnd));
              });
              if (isBlocked) isAvailable = false;
            }
          }
          return isAvailable;
        });

        const score = availableParticipants.length / participants.length;
        if (score >= 0.5) {
            allSlots.push({
                dateStr,
                dateObj: day,
                startMin: timeStart,
                endMin: timeEnd,
                score,
                availableCount: availableParticipants.length,
                attendees: availableParticipants.map(p => p.name),
                absentees: participants.filter(p => !availableParticipants.includes(p)).map(p => p.name)
            });
        }
      }
    });

    const merged = [];
    if (allSlots.length === 0) return [];

    let current = { ...allSlots[0], endMin: allSlots[0].endMin };

    for (let i = 1; i < allSlots.length; i++) {
      const slot = allSlots[i];
      if (
        slot.dateStr === current.dateStr &&
        slot.startMin === current.endMin &&
        slot.availableCount === current.availableCount
      ) {
        current.endMin = slot.endMin;
      } else {
        merged.push(current);
        current = { ...slot, endMin: slot.endMin };
      }
    }
    merged.push(current);

    return merged.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        return a.startMin - b.startMin;
    });

  }, [event]);

  const getScoreIcon = (score) => {
    if (score === 1.0) return <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-bold border border-green-200">◎</div>;
    if (score >= 0.75) return <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold border border-indigo-200">〇</div>;
    return <div className="w-8 h-8 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center font-bold border border-yellow-200">△</div>;
  };

  // メモがあるかチェックするヘルパー
  const getMemosForDate = (dateStr) => {
    return participants
      .map(p => ({ name: p.name, msg: p.availabilities.find(a => a.dateStr === dateStr)?.memo }))
      .filter(item => item.msg && item.msg.trim() !== '');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-gray-500 mb-2 px-1">
        <span>候補日時リスト (参加率順)</span>
        <span>参加人数: {participants.length}名</span>
      </div>

      {participants.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>まだ回答がありません。</p>
        </div>
      ) : aggregatedSlots.length === 0 ? (
        <div className="text-center py-10 bg-rose-50 rounded-xl text-rose-500">
          <AlertCircle className="w-10 h-10 mx-auto mb-2" />
          <p>条件に合う候補日時が見つかりませんでした。</p>
        </div>
      ) : (
        aggregatedSlots.map((slot, idx) => {
          const memos = getMemosForDate(slot.dateStr);
          const hasMemos = memos.length > 0;
          const isMemoOpen = openMemoIndices.includes(idx);

          return (
            <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
               <div className="flex items-center gap-4">
                  {getScoreIcon(slot.score)}
                  <div className="flex-1">
                      <div className="font-bold text-gray-800 text-lg flex items-center gap-3">
                          <span>{format(slot.dateObj, 'MM/dd (E)', { locale: ja })}</span>
                          <span className="text-indigo-700 font-mono">
                              {minutesToTime(slot.startMin)} - {minutesToTime(slot.endMin)}
                          </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2 items-center">
                         <span className="font-medium text-green-700">OK: {slot.attendees.length}人</span>
                         {slot.absentees.length > 0 && (
                             <span className="text-rose-400">NG: {slot.absentees.join(', ')}</span>
                         )}
                         
                         {/* メモボタン */}
                         {hasMemos && (
                           <button 
                             onClick={() => toggleMemo(idx)}
                             className={`ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors ${isMemoOpen ? 'bg-gray-200 text-gray-700' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                           >
                             <MessageCircle className="w-3 h-3" />
                             {isMemoOpen ? '閉じる' : `メモ (${memos.length})`}
                           </button>
                         )}
                      </div>
                  </div>
               </div>

               {/* メモ展開表示 */}
               {isMemoOpen && hasMemos && (
                 <div className="mt-3 pt-3 border-t border-gray-100 bg-gray-50 rounded p-2">
                   <div className="text-xs text-gray-500 mb-2 font-bold">この日のメモ:</div>
                   <div className="space-y-2">
                     {memos.map((m, mi) => (
                       <div key={mi} className="flex items-start gap-2 text-sm">
                         <span className="font-bold text-gray-700 whitespace-nowrap">{m.name}:</span>
                         <span className="text-gray-600 bg-white px-2 py-1 rounded border border-gray-200 w-full">{m.msg}</span>
                       </div>
                     ))}
                   </div>
                 </div>
               )}
            </div>
          );
        })
      )}
    </div>
  );
};

// 5. ダッシュボード画面 (親コンポーネント)
const Dashboard = ({ eventData, onUpdateEvent }) => {
  const [activeTab, setActiveTab] = useState('input'); // 'input' | 'result'
  const [editingParticipant, setEditingParticipant] = useState(null);

  const handleSaveParticipant = (participant) => {
    const existingIdx = eventData.participants.findIndex(p => p.id === participant.id);
    let newParticipants = [...eventData.participants];
    
    if (existingIdx >= 0) {
      newParticipants[existingIdx] = participant;
    } else {
      newParticipants.push(participant);
    }

    onUpdateEvent({ ...eventData, participants: newParticipants });
    setEditingParticipant(null); // フォームを閉じる
  };

  const handleDeleteParticipant = (id) => {
      if(confirm('この回答を削除しますか？')) {
        const newParticipants = eventData.participants.filter(p => p.id !== id);
        onUpdateEvent({ ...eventData, participants: newParticipants });
      }
  };

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="bg-white border-b border-indigo-100 sticky top-0 z-20 shadow-sm">
        <div className="p-4 max-w-3xl mx-auto">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{eventData.title}</h1>
          <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap line-clamp-2">{eventData.description}</p>
          <div className="flex items-center gap-2 text-xs text-indigo-600 font-medium mt-2 bg-indigo-50 inline-flex px-2 py-1 rounded">
             <Calendar className="w-3 h-3" />
             {eventData.candidateDates && eventData.candidateDates.length > 0 
                ? `${eventData.candidateDates.length}日間の候補`
                : `${format(eventData.period.start, 'yyyy/MM/dd')} 〜 ${format(eventData.period.end, 'yyyy/MM/dd')}`
             }
          </div>
        </div>
        
        <div className="flex border-t border-gray-200">
            <button 
                onClick={() => { setActiveTab('input'); setEditingParticipant(null); }}
                className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'input' ? 'border-indigo-600 text-indigo-600 bg-indigo-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
            >
                <Edit3 className="w-4 h-4" /> 予定を入力
            </button>
            <button 
                onClick={() => setActiveTab('result')}
                className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'result' ? 'border-indigo-600 text-indigo-600 bg-indigo-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
            >
                <Check className="w-4 h-4" /> 集計結果
            </button>
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'input' && (
          <div>
            {editingParticipant ? (
              <InputForm 
                eventData={eventData}
                initialData={editingParticipant}
                onSave={handleSaveParticipant}
                onCancel={() => setEditingParticipant(null)}
              />
            ) : (
                <div className="space-y-6">
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white shadow-lg text-center">
                        <h3 className="font-bold text-lg mb-2">あなたの予定を教えてください</h3>
                        <button 
                            onClick={() => setEditingParticipant({})}
                            className="bg-white text-indigo-600 px-6 py-3 rounded-full font-bold shadow hover:bg-gray-100 transition active:scale-95 flex items-center gap-2 mx-auto"
                        >
                            <Plus className="w-5 h-5" /> 新しく入力する
                        </button>
                    </div>

                    {eventData.participants.length > 0 && (
                        <div>
                            <h4 className="text-sm font-bold text-gray-500 mb-3 uppercase tracking-wider">回答済みのメンバー</h4>
                            <div className="space-y-2">
                                {eventData.participants.map(p => (
                                    <div key={p.id} className="bg-white p-4 rounded-lg border border-gray-200 flex justify-between items-center shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 font-bold text-lg">
                                                {p.name.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="font-bold text-gray-800">{p.name}</div>
                                                <div className="text-xs text-gray-500">
                                                    {p.mode === 'whitelist' ? '参加可のみ入力' : '参加不可のみ入力'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button 
                                                onClick={() => setEditingParticipant(p)}
                                                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                            >
                                                <Edit3 className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteParticipant(p.id)}
                                                className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
          </div>
        )}

        {activeTab === 'result' && (
          <ResultList event={eventData} />
        )}
      </div>
    </div>
  );
};


// --- Main App Component ---

export default function ScheduleApp() {
  const [eventData, setEventData] = useState(null);

  const loadDummyData = () => {
    setEventData(generateDummyData());
  };

  return (
    <div className="min-h-screen bg-slate-50 text-gray-800 font-sans">
      {!eventData ? (
        <div className="min-h-screen flex flex-col">
            <CreateEventScreen onCreate={setEventData} />
            
            <div className="mt-auto p-8 text-center">
                <button 
                    onClick={loadDummyData}
                    className="text-sm text-gray-400 hover:text-indigo-50 underline flex items-center justify-center gap-1 w-full"
                >
                    <Settings className="w-3 h-3" /> デバッグ用データをロード (開発用)
                </button>
            </div>
        </div>
      ) : (
        <Dashboard 
            eventData={eventData} 
            onUpdateEvent={setEventData} 
        />
      )}
    </div>
  );
}