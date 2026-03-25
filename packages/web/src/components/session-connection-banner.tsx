type SessionConnectionBannerProps = {
  message: string;
  onReconnect: () => void;
};

export function SessionConnectionBanner({ message, onReconnect }: SessionConnectionBannerProps) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-700 dark:text-red-400 break-words">{message}</p>
      </div>
      <button
        onClick={onReconnect}
        className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition flex-shrink-0"
      >
        Reconnect
      </button>
    </div>
  );
}
