export default function LibraryLoading() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="w-full max-w-xs flex flex-col gap-3">
        <p className="text-sm text-gray-300 text-center">Loading library…</p>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div className="h-2 bg-blue-500 rounded-full animate-pulse" style={{ width: "70%" }} />
        </div>
      </div>
    </div>
  );
}
