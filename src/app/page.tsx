"use client";
import { useEffect, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useRouter, useSearchParams } from "next/navigation";
import { io } from "socket.io-client";

// Dynamic socket connection - works for both localhost and network access
const getSocketUrl = () => {
  // If we're in browser and using network IP, use same host for backend
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Use live backend URL for production
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    return 'https://debate-backend-323e.onrender.com';
  }
  return 'https://debate-backend-323e.onrender.com'; // Fallback for server-side
};

// Initialize socket with lazy loading to avoid SSR issues
let socket: any = null;

const initializeSocket = () => {
  if (!socket && typeof window !== 'undefined') {
    const socketUrl = getSocketUrl();
    console.log("Attempting to connect to socket at:", socketUrl);
    
    socket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      forceNew: true,
      withCredentials: true
    });

    socket.on("connect_error", (error: any) => {
      console.error("Socket connection error:", error);
      console.error("Error details:", {
        message: error.message,
        description: error.description,
        type: error.type,
        context: error.context
      });
    });

    socket.on("connect", () => {
      console.log("Socket connected successfully to:", socketUrl);
    });

    socket.on("disconnect", (reason: string) => {
      console.log("Socket disconnected:", reason);
      if (reason === "io server disconnect") {
        // Server initiated disconnect, try to reconnect
        socket.connect();
      }
    });

    socket.on("reconnect", (attemptNumber: number) => {
      console.log("Socket reconnected after", attemptNumber, "attempts");
    });

    socket.on("reconnect_error", (error: any) => {
      console.error("Socket reconnection error:", error);
      console.error("Reconnection error details:", {
        message: error.message,
        description: error.description,
        type: error.type
      });
    });

    socket.on("reconnect_failed", () => {
      console.error("Socket reconnection failed after all attempts");
    });

    socket.on("error", (error: any) => {
      console.error("Socket general error:", error);
    });
  }
  return socket;
};

const DEBATE_TOPICS = [
  "Should artificial intelligence be regulated?",
  "Is social media doing more harm than good?",
  "Should college education be free?",
  "Is remote work better than office work?"
];

const TIMER_OPTIONS = [
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" }
];

export default function DebateRoom() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get('roomId');
  
  // Add mounted state to prevent hydration issues
  const [mounted, setMounted] = useState(false);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [joined, setJoined] = useState(false);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<{ user: string; userName: string; text: string; id?: string; timestamp?: Date; audio?: string; analysis?: string }[]>([]);
  const [isCreatingRoom, setIsCreatingRoom] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [roomUsers, setRoomUsers] = useState<{id: string, name: string}[]>([]);
  
  // Add topic selection states
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [useCustomTopic, setUseCustomTopic] = useState(false);
  
  // Timer related states
  const [timerDuration, setTimerDuration] = useState(120); // Default 2 minutes
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [debateEnded, setDebateEnded] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [winner, setWinner] = useState("");
  
  // Room creation form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatorName, setCreatorName] = useState("");
  const [selectedTimer, setSelectedTimer] = useState(120);
  
  // Join room form states
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");

  // Add audio recording states
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioSupported, setAudioSupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Add ref to track if AI analysis has been triggered
  const aiAnalysisTriggeredRef = useRef(false);

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Generate and persist userId only on client side
  useEffect(() => {
    if (!mounted) return;
    
    const storedUserId = sessionStorage.getItem('debateUserId');
    
    if (!storedUserId) {
      const newUserId = uuidv4();
      setUserId(newUserId);
      sessionStorage.setItem('debateUserId', newUserId);
      console.log("Generated new userId:", newUserId);
    } else {
      setUserId(storedUserId);
      console.log("Using stored userId:", storedUserId);
    }
  }, [mounted]);

  // Timer countdown effect - FIXED: Only trigger AI analysis once
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (timerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setTimerActive(false);
            setDebateEnded(true);
            // Only trigger AI analysis if it hasn't been triggered yet
            if (!aiAnalysisTriggeredRef.current) {
              aiAnalysisTriggeredRef.current = true;
              triggerAiAnalysis();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [timerActive, timeLeft]);

  // Initialize socket only on client side - FIXED: Prevent duplicate event listeners
  useEffect(() => {
    if (!mounted) return;
    
    const socketInstance = initializeSocket();
    if (!socketInstance) return;

    // Remove all existing listeners first to prevent duplicates
    socketInstance.removeAllListeners();

    socketInstance.on("connect", () => {
      console.log("Connected to server at:", getSocketUrl());
      setError("");
      // Request available topics when connected
      socketInstance.emit("get-topics");
    });

    socketInstance.on("available-topics", (topics: string[]) => {
      console.log("Received available topics:", topics);
      setAvailableTopics(topics);
    });

    socketInstance.on("disconnect", () => {
      console.log("Disconnected from server");
      setError("Disconnected from server. Attempting to reconnect...");
      // Don't reset joined state on disconnect to maintain room state
    });

    socketInstance.on("room-full", () => {
      console.log("Room is full");
      setError("Room is full (maximum 2 participants allowed)");
      setJoined(false);
    });

    socketInstance.on("room-data", (data: any) => {
      console.log("Received room data:", data);
      setTopic(data.topic);
      setChat(data.messages || []);
      setRoomUsers(data.users || []);
      setTimerDuration(data.timerDuration || 120);
      setTimeLeft(data.timeLeft || data.timerDuration || 120);
      setTimerActive(data.timerActive || false);
      setDebateEnded(data.debateEnded || false);
      setWinner(data.winner || "");
      setJoined(true);
      setError("");
      setIsConnecting(false);
      
      // Only reset AI analysis trigger if debate hasn't ended
      if (!data.debateEnded) {
        aiAnalysisTriggeredRef.current = false;
      }
    });

    socketInstance.on("timer-update", (data: any) => {
      console.log("Timer update received:", data);
      setTimeLeft(data.timeLeft);
      setTimerActive(data.timerActive);
      if (data.debateEnded) {
        setDebateEnded(true);
        setTimerActive(false);
      }
    });

    socketInstance.on("new-message", (msg: any) => {
      console.log("New message received:", msg);
      setChat((prev) => [...prev, msg]);
    });

    socketInstance.on("timer-started", (data: any) => {
      console.log("Timer started:", data);
      setTimerActive(true);
      setTimeLeft(data.timeLeft);
      setDebateEnded(false);
      aiAnalysisTriggeredRef.current = false; // Reset trigger flag when timer starts
    });

    socketInstance.on("debate-ended", (data: any) => {
      console.log("Debate ended:", data);
      setDebateEnded(true);
      setTimerActive(false);
      setTimeLeft(0);
      setAiAnalyzing(true); // Set analyzing state when debate ends
    });

    socketInstance.on("ai-result", (data: any) => {
      console.log("AI result received:", data);
      setWinner(data.winner);
      setAiAnalyzing(false); // Clear analyzing state when result is received
      // Add AI message to chat only if it's not already there
      setChat(prev => {
        const hasAiMessage = prev.some(msg => msg.user === "AI" && msg.text === data.winner);
        if (!hasAiMessage) {
          return [...prev, {
            user: "AI",
            userName: "AI Judge",
            text: data.winner,
            id: uuidv4(),
            timestamp: new Date()
          }];
        }
        return prev;
      });
    });

    socketInstance.on("error", (errorMsg: string) => {
      console.error("Received error:", errorMsg);
      setError(errorMsg);
      setIsConnecting(false);
      setAiAnalyzing(false);
    });

    socketInstance.on("new-audio", (msg: any) => {
      console.log("New audio message received:", msg);
      setChat((prev) => [...prev, msg]);
    });

    return () => {
      // Clean up event listeners
      socketInstance.removeAllListeners();
    };
  }, [mounted]);

  // Auto-join room if roomId exists and user hasn't joined yet
  useEffect(() => {
    if (mounted && roomId && userId && !joined && !isConnecting && userName) {
      console.log("Auto-joining room:", roomId);
      joinRoom();
    }
  }, [mounted, roomId, userId, joined, isConnecting, userName]);

  const triggerAiAnalysis = () => {
    if (!mounted || !socket || !roomId || aiAnalysisTriggeredRef.current) return;
    
    console.log("Triggering AI analysis for room:", roomId);
    setAiAnalyzing(true); // Set analyzing state when triggering analysis
    socket.emit("analyze-debate", { roomId });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const createRoom = () => {
    if (!mounted || !socket || !creatorName.trim()) return;
    
    try {
      setIsConnecting(true);
      setError("");
      const newRoomId = uuidv4();
      const finalTopic = useCustomTopic ? customTopic : selectedTopic;
      
      if (!finalTopic.trim()) {
        setError("Please select or enter a topic");
        setIsConnecting(false);
        return;
      }
      
      console.log("Creating room:", { roomId: newRoomId, topic: finalTopic, userId, userName: creatorName, timerDuration: selectedTimer });
      
      setUserName(creatorName);
      socket.emit("create-room", { 
        roomId: newRoomId, 
        topic: finalTopic, 
        userId,
        userName: creatorName,
        timerDuration: selectedTimer
      });
      router.push(`/?roomId=${newRoomId}`);
    } catch (error) {
      console.error("Error creating room:", error);
      setError("Failed to create room. Please try again.");
      setIsConnecting(false);
    }
  };

  const joinRoom = () => {
    if (!mounted || !socket || !roomId || !userId || !userName) return;
    
    try {
      setIsConnecting(true);
      setError("");
      console.log("Joining room:", { roomId, userId, userName });
      socket.emit("join-room", { roomId, userId, userName });
    } catch (error) {
      console.error("Error joining room:", error);
      setError("Failed to join room. Please try again.");
      setIsConnecting(false);
    }
  };

  const handleJoinExistingRoom = () => {
    if (!joinName.trim() || !joinRoomId.trim()) return;
    
    setUserName(joinName);
    router.push(`/?roomId=${joinRoomId}`);
  };

  const sendMessage = () => {
    if (!mounted || !socket || !message.trim() || !roomId || !userId || debateEnded) return;
    
    try {
      console.log("Sending message:", { roomId, userId, userName, text: message });
      socket.emit("send-message", { roomId, userId, userName, text: message });
      setMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      setError("Failed to send message. Please try again.");
    }
  };

  const leaveRoom = () => {
    // Don't reset timer-related states when leaving
    setJoined(false);
    setChat([]);
    setTopic("");
    setRoomUsers([]);
    setUserName("");
    aiAnalysisTriggeredRef.current = false; // Reset AI analysis trigger
    router.push('/');
  };

  // Check for audio support on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasAudioSupport = !!(navigator.mediaDevices && 
        typeof navigator.mediaDevices.getUserMedia === 'function' && 
        window.MediaRecorder);
      setAudioSupported(hasAudioSupport);
    }
  }, []);

  // Add audio recording functions
  const startRecording = async () => {
    try {
      if (!audioSupported) {
        setError("Audio recording is not supported on this device");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Audio recording is not supported on this device");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setError("Failed to access microphone. Please check permissions and try again.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all audio tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const sendAudioMessage = async () => {
    if (!audioBlob || !mounted || !socket || !roomId || !userId || debateEnded) return;
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        const base64Audio = reader.result as string;
        console.log("Sending audio message");
        socket.emit("send-audio", { 
          roomId, 
          userId, 
          userName, 
          audio: base64Audio 
        });
        setAudioBlob(null);
      };
    } catch (error) {
      console.error("Error sending audio:", error);
      setError("Failed to send audio message. Please try again.");
    }
  };

  // Show loading state until component is mounted on client
  if (!mounted) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <div className="text-center">
          <div className="animate-pulse">
            <h1 className="text-2xl font-bold mb-6">Loading...</h1>
          </div>
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-center">Debate.com</h1>
        <div className="mb-4 text-sm text-gray-600 text-center">
          Connected to: {getSocketUrl()}
        </div>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <div className="space-y-6">
          {/* Create Room Section */}
          <div className="border rounded-lg p-6 bg-white shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-center">Create a New Debate Room</h2>
            
            {!showCreateForm ? (
              <div className="text-center">
                <button 
                  onClick={() => setShowCreateForm(true)}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors"
                >
                  Create Room
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Your Name:</label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Debate Topic:</label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="predefined"
                        checked={!useCustomTopic}
                        onChange={() => setUseCustomTopic(false)}
                        className="text-blue-500"
                      />
                      <label htmlFor="predefined">Choose from list</label>
                    </div>
                    {!useCustomTopic && (
                      <select
                        value={selectedTopic}
                        onChange={(e) => setSelectedTopic(e.target.value)}
                        className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select a topic</option>
                        {availableTopics.map((topic, index) => (
                          <option key={index} value={topic}>
                            {topic}
                          </option>
                        ))}
                      </select>
                    )}
                    
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="custom"
                        checked={useCustomTopic}
                        onChange={() => setUseCustomTopic(true)}
                        className="text-blue-500"
                      />
                      <label htmlFor="custom">Write your own topic</label>
                    </div>
                    {useCustomTopic && (
                      <input
                        type="text"
                        placeholder="Enter your debate topic"
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Debate Timer:</label>
                  <select 
                    value={selectedTimer}
                    onChange={(e) => setSelectedTimer(Number(e.target.value))}
                    className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIMER_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={createRoom}
                    disabled={isConnecting || !creatorName.trim() || (!useCustomTopic && !selectedTopic) || (useCustomTopic && !customTopic.trim())}
                    className={`flex-1 bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors ${
                      (isConnecting || !creatorName.trim() || (!useCustomTopic && !selectedTopic) || (useCustomTopic && !customTopic.trim())) ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {isConnecting ? 'Creating...' : 'Create Room'}
                  </button>
                  <button 
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Join Room Section */}
          <div className="border rounded-lg p-6 bg-white shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-center">Join Existing Room</h2>
            
            {!showJoinForm ? (
              <div className="text-center">
                <button 
                  onClick={() => setShowJoinForm(true)}
                  className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors"
                >
                  Join Room
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Your Name:</label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Room ID:</label>
                  <input
                    type="text"
                    placeholder="Enter Room ID"
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value)}
                    className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={handleJoinExistingRoom}
                    disabled={!joinName.trim() || !joinRoomId.trim() || isConnecting}
                    className={`flex-1 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors ${
                      (!joinName.trim() || !joinRoomId.trim() || isConnecting) ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {isConnecting ? 'Joining...' : 'Join Room'}
                  </button>
                  <button 
                    onClick={() => setShowJoinForm(false)}
                    className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show name input form if user hasn't entered name yet
  if (!userName) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Enter Your Name</h2>
          <p className="text-gray-600 mb-6">Please enter your name to join the debate room</p>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Your name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && joinName.trim() && setUserName(joinName)}
              className="w-full border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button 
              onClick={() => setUserName(joinName)}
              disabled={!joinName.trim()}
              className={`w-full bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors ${
                !joinName.trim() ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="mb-4 flex justify-between items-center">
        <div className="text-sm text-gray-600">
          Room: {roomId} | Users: {roomUsers.length}/2
        </div>
        <button 
          onClick={leaveRoom}
          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded text-sm"
        >
          Leave Room
        </button>
      </div>
      
      {/* Timer Display */}
      {(timerActive || debateEnded) && (
        <div className="mb-4 text-center">
          <div className={`text-2xl font-bold ${timeLeft < 30 ? 'text-red-500' : 'text-blue-600'}`}>
            {debateEnded ? "Time's Up!" : formatTime(timeLeft)}
          </div>
          {debateEnded && !winner && (
            <div className="text-sm text-gray-600 mt-1">
              {aiAnalyzing ? "AI is analyzing the debate..." : "Debate ended"}
            </div>
          )}
        </div>
      )}
      
      {/* AI Analysis Loading */}
      {aiAnalyzing && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-blue-800">AI is analyzing the debate and determining the winner...</p>
        </div>
      )}
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {!joined ? (
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Join Room: {roomId}</h2>
          <button 
            onClick={joinRoom} 
            disabled={isConnecting}
            className={`bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg shadow-md transition-colors ${
              isConnecting ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isConnecting ? 'Joining...' : 'Join Debate'}
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-bold mb-4">Topic: {topic}</h2>
          <div className="border p-4 h-96 overflow-y-auto mb-4 bg-gray-50 rounded-lg shadow-inner">
            {chat.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                {roomUsers.length < 2 ? 
                  "Waiting for another participant to start the debate..." : 
                  "No messages yet. Start the debate!"
                }
              </div>
            ) : (
              chat.map((msg, idx) => (
                <div key={idx} className={`mb-3 ${msg.user === userId ? "text-right" : "text-left"}`}>
                  {msg.user === "AI" ? (
                    <div className="bg-purple-100 border border-purple-300 rounded-lg p-4 mb-2">
                      <div className="font-bold text-purple-800 mb-2">🤖 AI Judge Decision:</div>
                      <div className="text-purple-700">{msg.text}</div>
                    </div>
                  ) : msg.audio ? (
                    <div className={`inline-block px-4 py-2 rounded-lg max-w-xs break-words ${
                      msg.user === userId 
                        ? "bg-blue-500 text-white" 
                        : "bg-gray-200 text-gray-800"
                    }`}>
                      <div className="text-xs opacity-75 mb-1">
                        {msg.userName || "Anonymous"} (Audio Message)
                      </div>
                      <audio controls className="w-full">
                        <source src={msg.audio} type="audio/webm" />
                        Your browser does not support the audio element.
                      </audio>
                      {msg.analysis && (
                        <div className="mt-2 p-2 bg-gray-100 rounded text-sm">
                          <div className="font-semibold mb-1">AI Analysis:</div>
                          <div className="whitespace-pre-wrap">{msg.analysis}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`inline-block px-4 py-2 rounded-lg max-w-xs break-words ${
                      msg.user === userId 
                        ? "bg-blue-500 text-white" 
                        : "bg-gray-200 text-gray-800"
                    }`}>
                      <div className="text-xs opacity-75 mb-1">
                        {msg.userName || "Anonymous"}
                      </div>
                      <div>{msg.text}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              className="flex-grow border px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={debateEnded ? "Debate has ended" : "Type your opinion..."}
              disabled={!joined || debateEnded}
            />
            <button 
              onClick={sendMessage} 
              disabled={!message.trim() || !joined || debateEnded}
              className={`bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg shadow-md transition-colors ${
                (!message.trim() || !joined || debateEnded) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              Send
            </button>
            {!debateEnded && audioSupported && (
              <>
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg shadow-md transition-colors"
                  >
                    🎤 Record
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg shadow-md transition-colors animate-pulse"
                  >
                    ⏹ Stop
                  </button>
                )}
                {audioBlob && (
                  <button
                    onClick={sendAudioMessage}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg shadow-md transition-colors"
                  >
                    📤 Send Audio
                  </button>
                )}
              </>
            )}
          </div>
          {debateEnded && (
            <div className="mt-2 text-center text-sm text-gray-600">
              The debate has ended. No more messages can be sent.
            </div>
          )}
        </div>
      )}
    </div>
  );
}