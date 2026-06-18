export default function Loading() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-col items-center gap-4 py-20 max-w-sm mx-auto w-full">
        <div className="w-full max-w-xs flex flex-col gap-3">
          <p className="text-sm text-gray-300 text-center">Loading…</p>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div className="h-2 rounded-full bg-blue-500 animate-pulse" style={{ width: "25%" }} />
          </div>
          <p className="text-xs text-gray-600 text-center">25%</p>
        </div>
      </div>
    </main>
  );
}
