import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { apiUrl } from '../lib/api';

export function getUserInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'ST';
}

export function UserAvatar({
  name,
  imageUrl,
  className,
  imageClassName,
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
  imageClassName?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <div className={cn('shrink-0 overflow-hidden rounded-full border-2 border-emerald-500 bg-white p-0.5 dark:bg-black', className)}>
      {imageUrl && !imageFailed ? (
        <img
          src={apiUrl(imageUrl)}
          alt={`${name} profile photo`}
          draggable={false}
          onError={() => setImageFailed(true)}
          className={cn('h-full w-full rounded-full object-cover', imageClassName)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-emerald-500/10 text-sm font-black tracking-widest text-neutral-800 dark:bg-emerald-950/50 dark:text-white">
          {getUserInitials(name)}
        </div>
      )}
    </div>
  );
}
