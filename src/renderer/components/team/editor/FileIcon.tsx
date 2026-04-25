import { FileText } from 'lucide-react';

interface FileIconProps {
  filename?: string;
  fileName?: string;
  size?: number;
  className?: string;
}

export const FileIcon = ({ size = 16, className }: FileIconProps): React.JSX.Element => {
  return <FileText size={size} className={className} />;
};
