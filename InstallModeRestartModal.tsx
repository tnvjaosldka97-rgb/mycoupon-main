import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Smartphone } from "lucide-react";

interface InstallModeRestartModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Install 모드에서 버튼이 작동하지 않을 때 표시되는 안내 모달
 * 사용자에게 앱을 재시작하도록 안내
 */
export function InstallModeRestartModal({ open, onOpenChange }: InstallModeRestartModalProps) {
  const handleRestart = () => {
    // install 모드 해제
    sessionStorage.removeItem('install-mode');
    // 페이지 강제 새로고침 (캐시 무시)
    window.location.href = window.location.origin + window.location.pathname;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-6 text-center">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-orange-600" />
            </div>
          </div>
          <DialogTitle className="text-2xl font-bold text-primary">
            앱 설치가 완료되었습니다
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2 text-base">
            바탕화면에 앱 설치 중입니다. 
            <br />
            앱을 통해서 접속해주세요.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-center gap-3 text-lg font-medium text-gray-700">
            <Smartphone className="w-6 h-6 text-primary" />
            <span>홈 화면에서 앱 아이콘을 찾아주세요</span>
          </div>
          
          <div className="bg-orange-50 rounded-lg p-4 text-sm text-left">
            <p className="text-orange-800 font-medium mb-2">💡 안내사항:</p>
            <ul className="list-disc list-inside space-y-1 text-orange-700">
              <li>앱 설치가 완료되면 홈 화면에 아이콘이 표시됩니다</li>
              <li>홈 화면의 앱 아이콘을 눌러서 접속해주세요</li>
              <li>앱에서 로그인하면 더 빠르게 이용할 수 있습니다</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <Button 
            onClick={handleRestart}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-accent text-white text-lg font-bold"
            size="lg"
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            다시 시도하기
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-xl"
          >
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

