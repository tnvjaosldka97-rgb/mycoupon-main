// ============================================
// District Stamps Router - 동네 도장판
// PostgreSQL + Drizzle ORM 버전
// ============================================

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { sql, eq, and, desc } from "drizzle-orm";
import { 
  districtStampBoards, 
  districtStampSlots, 
  userDistrictStamps, 
  userStampBoardProgress,
  stores,
  users,
  userCoupons,
  userStats,
  badges
} from "../../drizzle/schema";

export const districtStampsRouter = router({
  // ========================================
  // 1. 도장판 목록 조회
  // ========================================
  list: publicProcedure
    .input(z.object({
      district: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      
      let query = db
        .select({
          id: districtStampBoards.id,
          district: districtStampBoards.district,
          name: districtStampBoards.name,
          description: districtStampBoards.description,
          requiredStamps: districtStampBoards.requiredStamps,
          rewardType: districtStampBoards.rewardType,
          rewardDescription: districtStampBoards.rewardDescription,
          isActive: districtStampBoards.isActive,
        })
        .from(districtStampBoards)
        .where(eq(districtStampBoards.isActive, true));
      
      if (input?.district) {
        query = query.where(eq(districtStampBoards.district, input.district));
      }
      
      const boards = await query;
      
      // 각 도장판의 슬롯 수 계산
      const boardsWithSlots = await Promise.all(
        boards.map(async (board) => {
          const slots = await db
            .select()
            .from(districtStampSlots)
            .where(eq(districtStampSlots.boardId, board.id));
          
          return {
            ...board,
            totalSlots: slots.length,
          };
        })
      );
      
      return boardsWithSlots;
    }),

  // ========================================
  // 2. 특정 도장판 상세 조회
  // ========================================
  getBoard: publicProcedure
    .input(z.object({
      boardId: z.number(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      
      // 도장판 정보
      const board = await db
        .select()
        .from(districtStampBoards)
        .where(eq(districtStampBoards.id, input.boardId))
        .limit(1);
      
      if (board.length === 0) return null;
      
      // 도장판 슬롯 (매장) 목록
      const slots = await db
        .select({
          id: districtStampSlots.id,
          boardId: districtStampSlots.boardId,
          storeId: districtStampSlots.storeId,
          slotOrder: districtStampSlots.slotOrder,
          isRequired: districtStampSlots.isRequired,
          storeName: stores.name,
          storeCategory: stores.category,
          storeImageUrl: stores.imageUrl,
          storeAddress: stores.address,
        })
        .from(districtStampSlots)
        .leftJoin(stores, eq(districtStampSlots.storeId, stores.id))
        .where(eq(districtStampSlots.boardId, input.boardId))
        .orderBy(districtStampSlots.slotOrder);
      
      return {
        ...board[0],
        slots,
      };
    }),

  // ========================================
  // 3. 사용자의 도장판 진행 상황 조회
  // ========================================
  myProgress: protectedProcedure
    .input(z.object({
      boardId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      
      // 진행 상황 조회
      let progress = await db
        .select()
        .from(userStampBoardProgress)
        .where(
          and(
            eq(userStampBoardProgress.userId, ctx.user.id),
            eq(userStampBoardProgress.boardId, input.boardId)
          )
        )
        .limit(1);
      
      // 없으면 생성
      if (progress.length === 0) {
        await db.insert(userStampBoardProgress).values({
          userId: ctx.user.id,
          boardId: input.boardId,
          collectedStamps: 0,
          isCompleted: false,
          rewardClaimed: false,
        });
        
        progress = await db
          .select()
          .from(userStampBoardProgress)
          .where(
            and(
              eq(userStampBoardProgress.userId, ctx.user.id),
              eq(userStampBoardProgress.boardId, input.boardId)
            )
          )
          .limit(1);
      }
      
      // 수집한 도장 목록
      const stamps = await db
        .select({
          id: userDistrictStamps.id,
          slotId: userDistrictStamps.slotId,
          storeId: userDistrictStamps.storeId,
          stampedAt: userDistrictStamps.stampedAt,
          storeName: stores.name,
          storeCategory: stores.category,
          storeImageUrl: stores.imageUrl,
        })
        .from(userDistrictStamps)
        .leftJoin(stores, eq(userDistrictStamps.storeId, stores.id))
        .where(
          and(
            eq(userDistrictStamps.userId, ctx.user.id),
            eq(userDistrictStamps.boardId, input.boardId)
          )
        )
        .orderBy(desc(userDistrictStamps.stampedAt));
      
      return {
        ...progress[0],
        stamps,
      };
    }),

  // ========================================
  // 4. 도장 획득 (쿠폰 사용 시 자동 호출)
  // ========================================
  collectStamp: protectedProcedure
    .input(z.object({
      storeId: z.number(),
      userCouponId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      
      // 해당 매장이 포함된 도장판 슬롯 찾기
      const slots = await db
        .select({
          slotId: districtStampSlots.id,
          boardId: districtStampSlots.boardId,
          storeId: districtStampSlots.storeId,
          district: districtStampBoards.district,
          requiredStamps: districtStampBoards.requiredStamps,
          rewardType: districtStampBoards.rewardType,
          rewardValue: districtStampBoards.rewardValue,
          rewardDescription: districtStampBoards.rewardDescription,
        })
        .from(districtStampSlots)
        .leftJoin(districtStampBoards, eq(districtStampSlots.boardId, districtStampBoards.id))
        .where(
          and(
            eq(districtStampSlots.storeId, input.storeId),
            eq(districtStampBoards.isActive, true)
          )
        );
      
      if (slots.length === 0) {
        return { success: false, message: '도장판에 포함되지 않은 매장입니다', results: [] };
      }
      
      const results = [];
      
      for (const slot of slots) {
        // 이미 도장을 받았는지 확인
        const existingStamp = await db
          .select()
          .from(userDistrictStamps)
          .where(
            and(
              eq(userDistrictStamps.userId, ctx.user.id),
              eq(userDistrictStamps.boardId, slot.boardId),
              eq(userDistrictStamps.slotId, slot.slotId)
            )
          )
          .limit(1);
        
        if (existingStamp.length > 0) {
          continue; // 이미 도장 받음
        }
        
        // 도장 추가
        await db.insert(userDistrictStamps).values({
          userId: ctx.user.id,
          boardId: slot.boardId,
          slotId: slot.slotId,
          storeId: input.storeId,
          userCouponId: input.userCouponId,
        });
        
        // 진행 상황 업데이트 (UPSERT using onConflictDoUpdate)
        await db
          .insert(userStampBoardProgress)
          .values({
            userId: ctx.user.id,
            boardId: slot.boardId,
            collectedStamps: 1,
            isCompleted: false,
            rewardClaimed: false,
          })
          .onConflictDoUpdate({
            target: [userStampBoardProgress.userId, userStampBoardProgress.boardId],
            set: {
              collectedStamps: sql`${userStampBoardProgress.collectedStamps} + 1`,
              updatedAt: sql`NOW()`,
            },
          });
        
        // 완성 여부 확인
        const progressResult = await db
          .select()
          .from(userStampBoardProgress)
          .where(
            and(
              eq(userStampBoardProgress.userId, ctx.user.id),
              eq(userStampBoardProgress.boardId, slot.boardId)
            )
          )
          .limit(1);
        
        const currentStamps = progressResult[0]?.collectedStamps || 0;
        
        if (currentStamps >= slot.requiredStamps) {
          // 도장판 완성!
          await db
            .update(userStampBoardProgress)
            .set({
              isCompleted: true,
              completedAt: sql`NOW()`,
            })
            .where(
              and(
                eq(userStampBoardProgress.userId, ctx.user.id),
                eq(userStampBoardProgress.boardId, slot.boardId)
              )
            );
          
          results.push({
            boardId: slot.boardId,
            district: slot.district,
            completed: true,
            currentStamps,
            requiredStamps: slot.requiredStamps,
            rewardType: slot.rewardType,
            rewardDescription: slot.rewardDescription,
          });
        } else {
          results.push({
            boardId: slot.boardId,
            district: slot.district,
            completed: false,
            currentStamps,
            requiredStamps: slot.requiredStamps,
          });
        }
      }
      
      return { success: true, results };
    }),

  // ========================================
  // 5. 보상 수령
  // ========================================
  claimReward: protectedProcedure
    .input(z.object({
      boardId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      
      // 진행 상황 확인
      const progress = await db
        .select({
          id: userStampBoardProgress.id,
          isCompleted: userStampBoardProgress.isCompleted,
          rewardClaimed: userStampBoardProgress.rewardClaimed,
          rewardType: districtStampBoards.rewardType,
          rewardValue: districtStampBoards.rewardValue,
          rewardDescription: districtStampBoards.rewardDescription,
        })
        .from(userStampBoardProgress)
        .leftJoin(districtStampBoards, eq(userStampBoardProgress.boardId, districtStampBoards.id))
        .where(
          and(
            eq(userStampBoardProgress.userId, ctx.user.id),
            eq(userStampBoardProgress.boardId, input.boardId)
          )
        )
        .limit(1);
      
      if (progress.length === 0) throw new Error('도장판 진행 상황을 찾을 수 없습니다');
      if (!progress[0].isCompleted) throw new Error('도장판을 완성하지 않았습니다');
      if (progress[0].rewardClaimed) throw new Error('이미 보상을 수령했습니다');
      
      const progressData = progress[0];
      
      // 보상 지급 (타입별)
      if (progressData.rewardType === 'points' && progressData.rewardValue) {
        // 포인트 지급
        await db
          .update(userStats)
          .set({
            points: sql`${userStats.points} + ${progressData.rewardValue}`,
          })
          .where(eq(userStats.userId, ctx.user.id));
        
        // 포인트 트랜잭션 기록 (point_transactions 테이블이 있다면)
        // await db.insert(pointTransactions).values({...});
      } else if (progressData.rewardType === 'coupon' && progressData.rewardValue) {
        // 쿠폰 지급
        const couponCode = `STAMP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30일 후
        
        await db.insert(userCoupons).values({
          userId: ctx.user.id,
          couponId: progressData.rewardValue,
          couponCode,
          pinCode,
          status: 'active',
          expiresAt,
        });
      }
      
      // 보상 수령 처리
      await db
        .update(userStampBoardProgress)
        .set({
          rewardClaimed: true,
          rewardClaimedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(userStampBoardProgress.userId, ctx.user.id),
            eq(userStampBoardProgress.boardId, input.boardId)
          )
        );
      
      return {
        success: true,
        rewardType: progressData.rewardType,
        rewardValue: progressData.rewardValue,
        rewardDescription: progressData.rewardDescription,
      };
    }),

  // ========================================
  // 6. 사용자의 모든 도장판 진행 상황
  // ========================================
  myAllProgress: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      
      const progressList = await db
        .select({
          id: userStampBoardProgress.id,
          boardId: userStampBoardProgress.boardId,
          collectedStamps: userStampBoardProgress.collectedStamps,
          isCompleted: userStampBoardProgress.isCompleted,
          completedAt: userStampBoardProgress.completedAt,
          rewardClaimed: userStampBoardProgress.rewardClaimed,
          rewardClaimedAt: userStampBoardProgress.rewardClaimedAt,
          district: districtStampBoards.district,
          boardName: districtStampBoards.name,
          requiredStamps: districtStampBoards.requiredStamps,
          rewardDescription: districtStampBoards.rewardDescription,
        })
        .from(userStampBoardProgress)
        .leftJoin(districtStampBoards, eq(userStampBoardProgress.boardId, districtStampBoards.id))
        .where(eq(userStampBoardProgress.userId, ctx.user.id))
        .orderBy(desc(userStampBoardProgress.updatedAt));
      
      return progressList;
    }),

  // ========================================
  // 7. 지역별 도장판 요약
  // ========================================
  districtSummary: publicProcedure
    .query(async () => {
      const db = await getDb();
      
      const summary = await db
        .select({
          district: districtStampBoards.district,
        })
        .from(districtStampBoards)
        .where(eq(districtStampBoards.isActive, true))
        .groupBy(districtStampBoards.district);
      
      // 각 지역별 통계 계산
      const summaryWithStats = await Promise.all(
        summary.map(async (item) => {
          const boards = await db
            .select()
            .from(districtStampBoards)
            .where(
              and(
                eq(districtStampBoards.district, item.district),
                eq(districtStampBoards.isActive, true)
              )
            );
          
          const slots = await db
            .select()
            .from(districtStampSlots)
            .leftJoin(districtStampBoards, eq(districtStampSlots.boardId, districtStampBoards.id))
            .where(eq(districtStampBoards.district, item.district));
          
          return {
            district: item.district,
            boardCount: boards.length,
            totalStamps: boards.reduce((sum, b) => sum + (b.requiredStamps || 0), 0),
            storeCount: slots.length,
          };
        })
      );
      
      return summaryWithStats;
    }),

  // ========================================
  // 8. 관리자: 도장판 생성
  // ========================================
  createBoard: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('관리자 권한이 필요합니다');
      }
      return next({ ctx });
    })
    .input(z.object({
      district: z.string(),
      name: z.string(),
      description: z.string().optional(),
      requiredStamps: z.number().min(1).max(20).default(10),
      rewardType: z.enum(['coupon', 'points', 'badge']),
      rewardValue: z.number().optional(),
      rewardDescription: z.string().optional(),
      storeIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      
      // 도장판 생성
      const boardResult = await db.insert(districtStampBoards).values({
        district: input.district,
        name: input.name,
        description: input.description,
        requiredStamps: input.requiredStamps,
        rewardType: input.rewardType,
        rewardValue: input.rewardValue,
        rewardDescription: input.rewardDescription,
        isActive: true,
      }).returning({ id: districtStampBoards.id });
      
      const boardId = boardResult[0].id;
      
      // 슬롯 생성
      for (let i = 0; i < input.storeIds.length; i++) {
        await db.insert(districtStampSlots).values({
          boardId,
          storeId: input.storeIds[i],
          slotOrder: i + 1,
          isRequired: false,
        });
      }
      
      return { success: true, boardId };
    }),

  // ========================================
  // 9. 관리자: 도장판에 매장 추가
  // ========================================
  addSlot: protectedProcedure
    .use(({ ctx, next }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('관리자 권한이 필요합니다');
      }
      return next({ ctx });
    })
    .input(z.object({
      boardId: z.number(),
      storeId: z.number(),
      slotOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      
      // 현재 최대 순서 조회
      let slotOrder = input.slotOrder;
      if (!slotOrder) {
        const maxOrderResult = await db
          .select({ maxOrder: sql<number>`MAX(${districtStampSlots.slotOrder})` })
          .from(districtStampSlots)
          .where(eq(districtStampSlots.boardId, input.boardId));
        
        slotOrder = (maxOrderResult[0]?.maxOrder || 0) + 1;
      }
      
      await db.insert(districtStampSlots).values({
        boardId: input.boardId,
        storeId: input.storeId,
        slotOrder,
        isRequired: false,
      });
      
      return { success: true };
    }),
});
